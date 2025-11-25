// frontend/src/views/visitor/pages/SearchForDeceased.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { NavLink } from "react-router-dom";
import fetchBurialRecords from "../js/get-burial-records";
import {
  fetchRoadPlots,
  buildGraph,
  buildRoutedPolyline,
  fmtDistance,
} from "../js/dijkstra-pathfinding";

import "leaflet/dist/leaflet.css";

// shadcn/ui
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "../../../components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../../../components/ui/dialog";

// --------------------------- utils: formatting ---------------------------
function formatDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

// --------------------------- utils: QR parsing ---------------------------
// Extract lat/lng from MANY token styles: JSON, nested JSON string, URL, geo:, WKT,
// "lat,lng", "lng,lat", Google Maps @lat,lng,zoom or q=lat,lng, KV pairs, etc.
function parseLatLngFromToken(token) {
  if (!token) return null;
  const raw = String(token).trim();

  // helper: try parse JSON or nested JSON
  const tryJson = (text) => {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === "object") {
        // direct lat/lng
        if (Number.isFinite(+obj.lat) && Number.isFinite(+obj.lng)) {
          return { lat: +obj.lat, lng: +obj.lng, data: obj };
        }
        // search object graph for lat/lng pairs
        const stack = [obj];
        while (stack.length) {
          const cur = stack.pop();
          if (cur && typeof cur === "object") {
            if (Number.isFinite(+cur.lat) && Number.isFinite(+cur.lng)) {
              return { lat: +cur.lat, lng: +cur.lng, data: obj };
            }
            for (const v of Object.values(cur)) {
              if (!v) continue;
              // nested JSON string
              if (typeof v === "string" && v.trim().startsWith("{") && v.trim().endsWith("}")) {
                try {
                  const nested = JSON.parse(v);
                  stack.push(nested);
                } catch {}
              } else if (typeof v === "object") {
                stack.push(v);
              }
            }
          }
        }
        return { lat: null, lng: null, data: obj };
      }
    } catch {}
    return null;
  };
  const jsonAttempt = tryJson(raw);
  if (jsonAttempt) return jsonAttempt;

  // geo: URI
  const mGeo = raw.match(/^geo:([+-]?\d+(?:\.\d+)?),([+-]?\d+(?:\.\d+)?)/i);
  if (mGeo) return { lat: +mGeo[1], lng: +mGeo[2], data: null };

  // Google Maps links:
  const mQ = raw.match(/[?&](?:q|query)=([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?)/i);
  if (mQ) return { lat: +mQ[1], lng: +mQ[2], data: null };

  // https://www.google.com/maps/@lat,lng,18z
  const mAt = raw.match(/\/@\s*([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?),/i);
  if (mAt) return { lat: +mAt[1], lng: +mAt[2], data: null };

  // URL params ?lat=...&lng=...
  const mUrlLat = raw.match(/[?&]lat=([+-]?\d+(?:\.\d+)?)/i);
  const mUrlLng = raw.match(/[?&]lng=([+-]?\d+(?:\.\d+)?)/i);
  if (mUrlLat && mUrlLng) return { lat: +mUrlLat[1], lng: +mUrlLng[1], data: null };

  // KEY:VAL pairs
  const mKVLat = raw.match(/(?:^|[|,;\s])lat\s*:\s*([+-]?\d+(?:\.\d+)?)(?=$|[|,;\s])/i);
  const mKVLng = raw.match(/(?:^|[|,;\s])lng\s*:\s*([+-]?\d+(?:\.\d+)?)(?=$|[|,;\s])/i);
  if (mKVLat && mKVLng) return { lat: +mKVLat[1], lng: +mKVLng[1], data: null };

  // WKT POINT (lng lat)
  const mPoint = raw.match(/POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)/i);
  if (mPoint) return { lat: +mPoint[2], lng: +mPoint[1], data: null };

  // Plain pair: "lat,lng" or "lng,lat" (decide by range)
  const mPair = raw.match(/([+-]?\d+(?:\.\d+)?)\s*[,\s]\s*([+-]?\d+(?:\.\d+)?)/);
  if (mPair) {
    const a = +mPair[1], b = +mPair[2];
    const looksLikeLatLng = Math.abs(a) <= 90 && Math.abs(b) <= 180;
    const looksLikeLngLat = Math.abs(a) <= 180 && Math.abs(b) <= 90 && !looksLikeLatLng;
    if (looksLikeLatLng) return { lat: a, lng: b, data: null };
    if (looksLikeLngLat) return { lat: b, lng: a, data: null };
    return { lat: a, lng: b, data: null };
  }

  return { lat: null, lng: null, data: null };
}

const QR_LABELS = {
  deceased_name: "Deceased Name",
  birth_date: "Birth Date",
  death_date: "Death Date",
  burial_date: "Burial Date",
};
const capitalizeLabelFromKey = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const formatQrValue = (key, value) => {
  if (value == null || value === "") return "—";
  if (key === "lat" || key === "lng") return Number.isFinite(+value) ? (+value).toFixed(6) : String(value);
  if (/(_date$|^created_at$|^updated_at$)/.test(key)) return formatDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};
function qrDisplayEntries(data) {
  const omit = new Set([
    "_type","id","uid","plot_id","family_contact","is_active","lat","lng",
    "created_at","updated_at","headstone_type","memorial_text"
  ]);
  return Object.entries(data)
    .filter(([k]) => !omit.has(k))
    .map(([k, v]) => ({ key: k, label: QR_LABELS[k] ?? capitalizeLabelFromKey(k), value: formatQrValue(k, v) }));
}

// --------------------------- utils: name matching ---------------------------
const normalizeName = (s) =>
  String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();

function levenshtein(a, b) {
  a = a || ""; b = b || "";
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[m][n];
}

const similarity = (a, b) => {
  const A = normalizeName(a), B = normalizeName(b);
  if (!A && !B) return 1;
  const dist = levenshtein(A, B);
  return 1 - dist / Math.max(A.length, B.length);
};

// Keep all Leaflet panes beneath app chrome (Topbar/Sidebar).
function ensureMapBehindUI(map, z = 0) {
  const container = map.getContainer();
  container.style.zIndex = String(z);      // container itself
  container.style.position = container.style.position || "relative";

  const panes = map.getPanes?.();
  if (!panes) return;

  // Lower every Leaflet pane
  panes.mapPane.style.zIndex     = String(z);
  panes.tilePane.style.zIndex    = String(z);
  panes.overlayPane.style.zIndex = String(z);
  panes.markerPane.style.zIndex  = String(z);
  panes.shadowPane.style.zIndex  = String(z);
  panes.tooltipPane.style.zIndex = String(z);
  panes.popupPane.style.zIndex   = String(z);
}


// =======================================================================
// Component
// =======================================================================
export default function SearchForDeceased() {
  // Data and search state
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nameQuery, setNameQuery] = useState("");  // ✅ single name field
  const [notFoundMsg, setNotFoundMsg] = useState("");

  // results
  const [results, setResults] = useState([]);       // strong fuzzy matches
  const [suggestions, setSuggestions] = useState([]); // weaker fuzzy matches

  // Selection and scan
  const [selected, setSelected] = useState(null);
  const [scanDataForSelected, setScanDataForSelected] = useState(null);
  const [scanResult, setScanResult] = useState(null); // { token, coords, data }

  // Location and routing state
  const [locationConsent, setLocationConsent] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [graph, setGraph] = useState(null);
  const [routeStatus, setRouteStatus] = useState("");
  const [routeDistance, setRouteDistance] = useState(0);
  const geoWatchIdRef = useRef(null);

  // Map
  const mapRef = useRef(null);
  const [mapMounted, setMapMounted] = useState(false);
  const leafletRef = useRef({
    L: null,
    map: null,
    startMarker: null,
    destMarker: null,
    routeLine: null
  });
  const [mapCoords, setMapCoords] = useState(null);
  const setMapNode = useCallback((n) => { mapRef.current = n; setMapMounted(!!n); }, []);

  // Scan modal
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [scanMode, setScanMode] = useState("choose");
  const [scanErr, setScanErr] = useState("");
  const videoRef = useRef(null);
  const rafRef = useRef(0);
  const fileRef = useRef(null);
  const canvasRef = useRef(null); // hidden canvas for jsQR

  // Default fallback location (cemetery entrance)
  const DEFAULT_START = { lat: 15.4942139, lng: 120.5547058 };

  // -------------------------- Build graph on mount --------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      setRouteStatus("Loading cemetery data…");
      try {
        const features = await fetchRoadPlots();
        if (!alive) return;
        setRouteStatus("Building cemetery graph…");
        const g = buildGraph(features, { k: 4, maxDist: 80 });
        if (!alive) return;
        setGraph(g);
        setRouteStatus(`Graph ready (${Object.keys(g).length} nodes)`);
      } catch (e) {
        console.error('Graph building failed:', e);
        setRouteStatus("Graph building failed");
      }
    })();
    return () => { alive = false; };
  }, []);

  // -------------------------- Load burial records ---------------------------
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError("");
    fetchBurialRecords()
      .then((data) => !ignore && setRows(Array.isArray(data) ? data : []))
      .catch((e) => !ignore && setError(e.message || "Failed to load"))
      .finally(() => !ignore && setLoading(false));
    return () => { ignore = true; };
  }, []);

  // -------------------------- Location permission ---------------------------
  useEffect(() => {
    if (mapCoords && !locationConsent) {
      setLocationModalOpen(true);
    }
  }, [mapCoords, locationConsent]);

  const requestUserLocation = useCallback(async () => {
    setLocationConsent(true);
    setLocationModalOpen(false);

    if (!("geolocation" in navigator)) {
      console.warn("Geolocation not available, using default start location");
      setUserLocation(DEFAULT_START);
      return;
    }

    const onSuccess = (position) => {
      const { latitude, longitude } = position.coords;
      const location = { lat: latitude, lng: longitude };
      setUserLocation(location);
    };
    const onError = (error) => {
      console.warn("Geolocation error:", error);
      setUserLocation(DEFAULT_START);
    };

    try {
      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 60000
      });

      if (geoWatchIdRef.current) {
        navigator.geolocation.clearWatch(geoWatchIdRef.current);
      }
      geoWatchIdRef.current = navigator.geolocation.watchPosition(onSuccess, onError, {
        enableHighAccuracy: true, timeout: 20000, maximumAge: 60000
      });
    } catch (e) {
      console.error("Geolocation setup failed:", e);
      setUserLocation(DEFAULT_START);
    }
  }, []);
  const useDefaultLocation = useCallback(() => {
    setLocationConsent(true);
    setLocationModalOpen(false);
    setUserLocation(DEFAULT_START);
  }, []);
  useEffect(() => {
    return () => {
      if (geoWatchIdRef.current) navigator.geolocation.clearWatch(geoWatchIdRef.current);
    };
  }, []);

  // ------------------------------- Map init --------------------------------
  useEffect(() => {
    let cancelled = false;
    if (!mapMounted || !mapCoords || !userLocation || !graph) return;

    (async () => {
      if (!leafletRef.current.L) {
        const mod = await import("leaflet");
        leafletRef.current.L = mod.default || mod;
      }
      const L = leafletRef.current.L;
      if (cancelled) return;

      if (leafletRef.current.map) {
        leafletRef.current.map.remove();
      }

      const map = L.map(mapRef.current).setView([mapCoords.lat, mapCoords.lng], 17);
      leafletRef.current.map = map;

      ensureMapBehindUI(map, 0);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap"
      }).addTo(map);

      leafletRef.current.destMarker = L.marker([mapCoords.lat, mapCoords.lng], {
        icon: L.divIcon({ html: "🎯", iconSize: [20, 20], className: "destination-marker" }),
      }).addTo(map).bindPopup("Grave Location");

      leafletRef.current.startMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 8, color: "#0ea5e9", weight: 3, fillOpacity: 0.8,
      }).addTo(map).bindPopup("Your Location");

      try {
        setRouteStatus("Computing optimal route…");
        const { polyline, distance } = await buildRoutedPolyline(
          userLocation, mapCoords, graph, { userM: 25, destM: 25 }
        );
        if (!cancelled) {
          if (!polyline.length) {
            setRouteStatus("No route found");
            return;
          }
          setRouteDistance(distance);
          if (leafletRef.current.routeLine) map.removeLayer(leafletRef.current.routeLine);
          leafletRef.current.routeLine = L.polyline(polyline, {
            weight: 4, opacity: 0.9, color: "#059669", smoothFactor: 1.0,
          }).addTo(map);
          const bounds = L.latLngBounds(polyline);
          map.fitBounds(bounds, { padding: [20, 20] });
          setRouteStatus("Route computed");
        }
      } catch (e) {
        console.error("Route computation failed:", e);
        setRouteStatus("Route computation failed");
      }
    })();

    return () => { cancelled = true; };
  }, [mapMounted, mapCoords, userLocation, graph]);

  // Recompute route on location changes
  useEffect(() => {
    if (!leafletRef.current.map || !mapCoords || !userLocation || !graph) return;
    const L = leafletRef.current.L;
    const map = leafletRef.current.map;

    if (leafletRef.current.startMarker) {
      leafletRef.current.startMarker.setLatLng([userLocation.lat, userLocation.lng]);
    }

    (async () => {
      try {
        setRouteStatus("Updating route…");
        const { polyline, distance } = await buildRoutedPolyline(
          userLocation, mapCoords, graph, { userM: 25, destM: 25 }
        );
        if (!polyline.length) {
          setRouteStatus("No route found");
          return;
        }
        setRouteDistance(distance);
        if (leafletRef.current.routeLine) map.removeLayer(leafletRef.current.routeLine);
        leafletRef.current.routeLine = L.polyline(polyline, {
          weight: 4, opacity: 0.9, color: "#059669", smoothFactor: 1.0,
        }).addTo(map);
        setRouteStatus("Route updated");
      } catch (e) {
        console.error("Route update failed:", e);
        setRouteStatus("Route update failed");
      }
    })();
  }, [userLocation, mapCoords, graph]);

  useEffect(() => {
    return () => {
      if (leafletRef.current.map) {
        try { leafletRef.current.map.remove(); } catch {}
      }
    };
  }, []);

  // ------------------------- Search form handlers --------------------------
  function onSubmit(e) {
    e.preventDefault();
    setScanResult(null);
    setNotFoundMsg("");
    setResults([]);
    setSuggestions([]);
    setSelected(null);
    setScanDataForSelected(null);
    setMapCoords(null);

    const q = nameQuery.trim();
    if (!q) {
      setNotFoundMsg("Please enter a name to search.");
      return;
    }

    const availableRows = rows.filter((r) => (r.deceased_name || "").trim().length > 0);
    if (!availableRows.length) {
      setNotFoundMsg("No burial records are available.");
      return;
    }

    // Fuzzy match on full name only (single query string)
    const withScores = availableRows
      .map((r) => ({
        row: r,
        score: similarity(q, r.deceased_name || ""),
      }))
      .sort((a, b) => b.score - a.score);

    const STRONG = 0.70;   // results threshold
    const WEAK_MIN = 0.40; // suggestions lower bound

    const strong = withScores.filter(({ score }) => score >= STRONG).map(({ row }) => row);
    const weak   = withScores.filter(({ score }) => score >= WEAK_MIN && score < STRONG).map(({ row }) => row);

    if (!strong.length && !weak.length) {
      setNotFoundMsg("No records found with a similar name.");
    }

    setResults(strong);
    setSuggestions(weak);

    if (strong.length === 1) handleSelect(strong[0]);
  }

  function handleSelect(row) {
    setScanResult(null);
    setSelected(row || null);

    const parsed = parseLatLngFromToken(row?.qr_token);
    const coords = parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)
      ? { lat: parsed.lat, lng: parsed.lng }
      : null;

    setScanDataForSelected(parsed?.data && typeof parsed.data === "object" ? parsed.data : null);
    setMapCoords(coords);
  }

  // ------------------------- QR: 3-tier decoding ---------------------------
  function closeScanModal() {
    stopCamera();
    setScanErr("");
    setScanMode("choose");
    setScanModalOpen(false);
  }

  async function startCamera() {
    setScanErr("");
    setScanMode("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }
      });
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();

      // 1) Native BarcodeDetector live
      let barcodeDetector = null;
      if ("BarcodeDetector" in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats?.();
          if (!formats || formats.includes("qr_code")) {
            barcodeDetector = new window.BarcodeDetector({ formats: ["qr_code"] });
          }
        } catch {}
      }

      const tick = async () => {
        try {
          if (barcodeDetector) {
            const codes = await barcodeDetector.detect(v);
            if (codes && codes.length) {
              handleQrFound(codes[0].rawValue || "");
              return;
            }
          }

          // 2) jsQR on a canvas
          const canvas = canvasRef.current || (canvasRef.current = document.createElement("canvas"));
          const cw = Math.min(1024, v.videoWidth || 640);
          const ch = Math.floor((cw / (v.videoWidth || 640)) * (v.videoHeight || 480));
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(v, 0, 0, cw, ch);
          const imageData = ctx.getImageData(0, 0, cw, ch);

          const { default: jsQR } = await import("jsqr");
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
          if (code && code.data) {
            handleQrFound(code.data);
            return;
          }
        } catch {}
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setScanErr("Unable to access camera.");
    }
  }

  function stopCamera() {
    cancelAnimationFrame(rafRef.current);
    const v = videoRef.current;
    if (v?.srcObject) {
      v.srcObject.getTracks?.().forEach((t) => t.stop?.());
      v.srcObject = null;
    }
  }

  // Decode from uploaded image using: BarcodeDetector → ZXing → jsQR
  async function handleUploadFile(file) {
    if (!file) return;
    setScanErr("");
    setScanMode("upload");

    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);

    try {
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = document.createElement("canvas");
      const cw = Math.min(1600, bmp.width);
      const ch = Math.floor((cw / bmp.width) * bmp.height);
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, cw, ch);

      // 1) BarcodeDetector
      if ("BarcodeDetector" in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats?.();
          if (!supported || supported.includes("qr_code")) {
            const det = new window.BarcodeDetector({ formats: ["qr_code"] });
            const codes = await det.detect(canvas);
            if (codes?.length) {
              handleQrFound(codes[0].rawValue || "");
              cleanup();
              return;
            }
          }
        } catch {}
      }

      // 2) ZXing
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const z = new BrowserQRCodeReader();
        const res = await z.decodeFromImageUrl(url);
        if (res?.getText) {
          handleQrFound(res.getText());
          cleanup();
          return;
        }
      } catch {}

      // 3) jsQR
      try {
        const imageData = ctx.getImageData(0, 0, cw, ch);
        const { default: jsQR } = await import("jsqr");
        const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });
        if (code && code.data) {
          handleQrFound(code.data);
          cleanup();
          return;
        }
      } catch {}

      setScanErr("No QR code detected in the image.");
    } catch (e) {
      setScanErr(e?.message || "Failed to decode QR image.");
    } finally {
      cleanup();
    }
  }

  function handleQrFound(text) {
    stopCamera();
    setScanModalOpen(false);
    setSelected(null);
    setScanDataForSelected(null);

    const parsed = parseLatLngFromToken(text);
    const coords = parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng)
      ? { lat: parsed.lat, lng: parsed.lng }
      : null;

    setMapCoords(coords);
    setScanResult({ token: text, coords, data: parsed?.data || null });
  }

  // ----------------------------- Result card ------------------------------
  function RecordCard({ row, onPick }) {
    const parsed = parseLatLngFromToken(row?.qr_token);
    const hasCoords = parsed && Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng);

    return (
      <div className="relative">
        {/* backdrop shadow */}
        <div className="absolute -inset-2 bg-gradient-to-br from-violet-400/20 via-purple-400/15 to-indigo-400/20 rounded-xl blur-xl opacity-30" />

        <Card className="group relative overflow-hidden border-white/60 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-white/40 shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
          {/* backdrop gradient */}
          <div className="absolute inset-0 bg-gradient-to-br from-violet-400/20 via-purple-400/15 to-indigo-400/20" />

          <CardHeader className="relative pb-2">
            <CardDescription className="text-slate-700 font-medium">
              {row.deceased_name ? row.deceased_name : "Unnamed"} · Born {formatDate(row.birth_date)} · Died {formatDate(row.death_date)}
            </CardDescription>
          </CardHeader>
          <CardContent className="relative flex items-center justify-between gap-4">
            <div className="text-sm text-slate-600" />
            <Button size="sm" onClick={() => onPick?.(row)} className="shadow-md hover:shadow-lg">
              View details {hasCoords ? "and location" : ""}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // =======================================================================
  // UI
  // =======================================================================
  return (
    <div className="relative min-h-screen font-poppins">
      {/* global backdrop */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100 via-cyan-50 to-blue-100" />
        <div className="absolute -top-24 -left-24 h-[32rem] w-[32rem] rounded-full bg-emerald-300/50 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute top-1/3 right-0 h-[28rem] w-[28rem] rounded-full bg-cyan-300/50 blur-3xl dark:bg-cyan-700/20" />
        <div className="absolute -bottom-32 left-1/4 h-[24rem] w-[24rem] rounded-full bg-blue-300/40 blur-3xl dark:bg-blue-700/20" />
      </div>

      {/* Header */}
      <section className="pt-24 pb-8">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-8">
          <div className="mb-2 text-sm text-slate-500">
            <NavLink to="/" className="hover:text-slate-700">Home</NavLink>
            &nbsp;›&nbsp;<span className="text-slate-700">Search For Deceased</span>
          </div>

          <div className="relative">
            {/* backdrop shadow */}
            <div className="absolute -inset-2 bg-gradient-to-br from-emerald-400/25 via-cyan-400/20 to-blue-400/25 rounded-2xl blur-xl opacity-40" />

            <Card className="relative overflow-hidden border-white/60 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-white/40 shadow-lg">
              {/* backdrop gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/20 via-cyan-400/15 to-blue-400/20" />

              <CardHeader className="relative pb-3">
                <CardTitle className="text-2xl sm:text-3xl text-slate-900">Search For Deceased</CardTitle>
                <CardDescription className="text-slate-600">
                  Search by name (fuzzy), or scan a QR code.
                </CardDescription>
              </CardHeader>
              <CardContent className="relative">
                {/* Search form */}
                <form
                  onSubmit={onSubmit}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                >
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label htmlFor="nameQuery" className="mb-1 block text-sm text-slate-600">
                      Name
                    </label>
                    <Input
                      id="nameQuery"
                      value={nameQuery}
                      onChange={(e) => setNameQuery(e.target.value)}
                      placeholder="e.g., Juan Dela Cruz"
                    />
                  </div>
                  <div className="sm:col-span-1 lg:col-span-1 flex gap-2 items-end">
                    <Button type="submit">Search</Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setNameQuery("");
                        setResults([]);
                        setSuggestions([]);
                        setNotFoundMsg("");
                        setSelected(null);
                        setScanDataForSelected(null);
                        setScanResult(null);
                        setMapCoords(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </form>

                {/* Divider + Scan button */}
                <div className="flex items-center gap-4 my-6">
                  <div className="h-px flex-1 bg-slate-200" />
                  <div className="text-xs uppercase tracking-wide text-slate-400">or</div>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div className="flex justify-center">
                  <Button
                    onClick={() => {
                      setScanModalOpen(true);
                      setScanMode("choose");
                      setScanErr("");
                    }}
                  >
                    Scan QR Code
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Loading / error states */}
      <section className="pb-6">
        <div className="mx-auto w-full max-w-7xl px-6 lg:px-8 space-y-3">
          {loading && (
            <Card className="bg-white/80 backdrop-blur shadow-md">
              <CardContent className="p-6 text-center text-slate-500">
                Loading records…
              </CardContent>
            </Card>
          )}
          {error && (
            <Card className="bg-white/80 backdrop-blur shadow-md border-rose-200">
              <CardContent className="p-6 text-center text-rose-600">
                {error}
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Search results */}
      {(results.length > 0 || suggestions.length > 0 || notFoundMsg) && (
        <section className="pb-2">
          <div className="mx-auto w-full max-w-7xl px-6 lg:px-8 space-y-4">
            {notFoundMsg && (
              <Card className="bg-white/80 backdrop-blur shadow-md border-amber-200">
                <CardContent className="p-6 text-center text-slate-600">
                  {notFoundMsg}
                </CardContent>
              </Card>
            )}

            {results.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">Results</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {results.map((r) => (
                    <RecordCard key={`res-${r.id}`} row={r} onPick={handleSelect} />
                  ))}
                </div>
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-slate-700">Suggestions</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {suggestions.map((r) => (
                    <RecordCard key={`sug-${r.id}`} row={r} onPick={handleSelect} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Selected record details + Map (from search) */}
      {selected && mapCoords && (
        <section className="pb-10">
          <div className="mx-auto w-full max-w-7xl px-6 lg:px-8 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="overflow-hidden lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Route to Grave</CardTitle>
                  <CardDescription>
                    From your location to the grave site
                    {routeDistance > 0 && <span> • <strong>{fmtDistance(routeDistance)}</strong></span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {routeStatus && (
                    <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-md">
                      Status: {routeStatus}
                    </div>
                  )}
                  <div ref={setMapNode} className="w-full h-[420px] rounded-md border z-0 relative" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Burial Record</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {scanDataForSelected && typeof scanDataForSelected === "object" ? (
                    <div className="space-y-2">
                      {(() => {
                        const entries = qrDisplayEntries(scanDataForSelected);
                        if (entries.length === 0) return <div className="text-sm text-slate-500">No displayable fields.</div>;
                        return entries.map(({ key, label, value }) => (
                          <div key={key} className="text-sm">
                            <div className="text-slate-500">{label}</div>
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 break-words">
                              {value}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <div className="space-y-2 text-sm">
                      <div>
                        <div className="text-slate-500">Deceased Name</div>
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 break-words">
                          {selected.deceased_name || "—"}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <div className="text-slate-500">Birth Date</div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800">
                            {formatDate(selected.birth_date)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500">Death Date</div>
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800">
                            {formatDate(selected.death_date)}
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Plot</div>
                        <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800">
                          {selected.plot_id ?? "—"}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="text-center">
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setScanDataForSelected(null);
                  setMapCoords(null);
                }}
              >
                Back to results
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Map + QR details (from scanning) */}
      {scanResult && mapCoords && (
        <section className="pb-6">
          <div className="mx-auto w-full max-w-7xl px-6 lg:px-8 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="overflow-hidden lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Route to Grave</CardTitle>
                  <CardDescription>
                    From your location to the grave site
                    {routeDistance > 0 && <span> • <strong>{fmtDistance(routeDistance)}</strong></span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {routeStatus && (
                    <div className="text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-md">
                      Status: {routeStatus}
                    </div>
                  )}
                  <div ref={setMapNode} className="w-full h-[420px] rounded-md border" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Burial Record</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {scanResult.data && typeof scanResult.data === "object" ? (
                    <div className="space-y-2">
                      {(() => {
                        const entries = qrDisplayEntries(scanResult.data);
                        if (entries.length === 0) return <div className="text-sm text-slate-500">No displayable fields.</div>;
                        return entries.map(({ key, label, value }) => (
                          <div key={key} className="text-sm">
                            <div className="text-slate-500">{label}</div>
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 break-words">
                              {value}
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-600 break-all">
                      <span className="font-semibold">Raw:</span> {scanResult.token}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="text-center">
              <Button onClick={() => {
                setScanResult(null);
                setScanModalOpen(true);
                setScanMode("choose");
                setMapCoords(null);
              }}>
                Scan another QR Code
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* Scan Modal */}
      <Dialog open={scanModalOpen} onOpenChange={(o) => (o ? setScanModalOpen(true) : closeScanModal())}>
        <DialogContent className="sm:max-w-2xl" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Scan a QR Code</DialogTitle>
            <DialogDescription>Use your camera or upload a QR image to locate a grave on the map.</DialogDescription>
          </DialogHeader>

          {scanMode === "choose" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Button onClick={startCamera}>Open Camera</Button>

              <div className="flex items-center justify-center">
                <label
                  htmlFor="qr-upload"
                  className="w-full cursor-pointer rounded-md border border-input bg-background px-4 py-2.5 text-center text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                >
                  Upload QR Image
                </label>
                <input
                  id="qr-upload"
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onClick={(e) => { e.currentTarget.value = ""; }}
                  onChange={(e) => handleUploadFile(e.target.files?.[0] || null)}
                />
              </div>
            </div>
          )}

          {scanMode === "camera" && (
            <div className="space-y-3">
              <div className="rounded-lg overflow-hidden border">
                <div className="w-full aspect-video bg-muted/40">
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                </div>
              </div>

              {scanErr && (
                <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
                  {scanErr}
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => { stopCamera(); setScanMode("choose"); }}>
                  Back
                </Button>
                <Button onClick={closeScanModal}>Close</Button>
              </DialogFooter>
            </div>
          )}

          {scanMode === "upload" && (
            <div className="text-sm text-slate-600">
              Processing image… {scanErr && <span className="text-rose-600 font-medium ml-2">{scanErr}</span>}
            </div>
          )}

          {scanErr && scanMode !== "upload" && scanMode !== "camera" && (
            <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-700 px-3 py-2 text-sm">
              {scanErr}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Location Permission Modal */}
      <Dialog open={locationModalOpen} onOpenChange={setLocationModalOpen}>
        <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Use Your Location?</DialogTitle>
            <DialogDescription>
              We need your location to show you the best route to the grave site.
              If you decline, we'll use the cemetery entrance as the starting point.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={useDefaultLocation}>
              Use Cemetery Entrance
            </Button>
            <Button onClick={requestUserLocation}>
              Allow Location Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
