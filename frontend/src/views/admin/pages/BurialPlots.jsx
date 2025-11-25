// frontend/src/views/admin/pages/BurialPlots.jsx
import { useEffect, useMemo, useState, useCallback } from "react";

import { getAuth } from "../../../utils/auth";
import { editPlot } from "../js/edit-plot";
import { addPlot } from "../js/add-plot";

import {
  Plus,
  Eye,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../../../components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table";
import { Switch } from "../../../components/ui/switch";
import { Badge } from "../../../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "../../../components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "../../../components/ui/alert-dialog";

import CemeteryMap, {
  CEMETERY_CENTER as GOOGLE_CENTER,
} from "../../../components/map/CemeteryMap";

// shadcn sonner toasts
import { Toaster, toast } from "sonner";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "";

/* ---------------- utils ---------------- */
function centroidOfFeature(feature) {
  try {
    if (!feature?.geometry) return null;
    const geom = feature.geometry;

    if (geom.type === "Point") {
      const [lng, lat] = geom.coordinates || [];
      if (typeof lat === "number" && typeof lng === "number") return [lat, lng];
      return null;
    }

    // For Polygon / MultiPolygon: use bounds center of outer ring(s)
    const collectCoords = () => {
      const coords = [];

      if (geom.type === "Polygon") {
        const outer = geom.coordinates?.[0] || [];
        for (const [lng, lat] of outer) {
          if (typeof lat === "number" && typeof lng === "number") {
            coords.push({ lat, lng });
          }
        }
      } else if (geom.type === "MultiPolygon") {
        for (const poly of geom.coordinates || []) {
          const outer = poly?.[0] || [];
          for (const [lng, lat] of outer) {
            if (typeof lat === "number" && typeof lng === "number") {
              coords.push({ lat, lng });
            }
          }
        }
      }

      return coords;
    };

    const coords = collectCoords();
    if (!coords.length) return null;

    let minLat = coords[0].lat;
    let maxLat = coords[0].lat;
    let minLng = coords[0].lng;
    let maxLng = coords[0].lng;

    for (const { lat, lng } of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }

    return [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
  } catch {
    return null;
  }
}

export default function BurialPlots() {
  const [fc, setFc] = useState(null);
  const [error, setError] = useState(null);
  const [onlyAvailable, setOnlyAvailable] = useState(true);

  // map view state
  const [mapCenter, setMapCenter] = useState(GOOGLE_CENTER);
  const [mapZoom, setMapZoom] = useState(19);

const [roadsFc, setRoadsFc] = useState(null);

  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [modalRow, setModalRow] = useState(null);

  // delete confirm
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const auth = getAuth();
  const token = auth?.token;
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  /* Fetch plots */
  const fetchPlots = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(`${API_BASE}/plot/`);
      const ct = res.headers.get("content-type") || "";
      if (!res.ok) {
        const body = ct.includes("application/json") ? await res.json() : await res.text();
        throw new Error(
          ct.includes("application/json") ? JSON.stringify(body) : body.slice(0, 200)
        );
      }
      const json = await res.json();
      setFc(json);
    } catch (e) {
      setError(String(e));
    }
  }, []);
const fetchRoads = useCallback(async () => {
  try {
    const res = await fetch(`${API_BASE}/plot/road-plots`);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      const body = ct.includes("application/json") ? await res.json() : await res.text();
      throw new Error(
        ct.includes("application/json") ? JSON.stringify(body) : body.slice(0, 200)
      );
    }
    const json = await res.json();
    setRoadsFc(json);
  } catch (e) {
    console.error("Failed to load road plots:", e);
    // optional: you can toast here if you want
  }
}, []);

useEffect(() => {
  fetchPlots();
  fetchRoads();      // 👈 also load road lines
}, [fetchPlots, fetchRoads]);

  const rows = useMemo(() => {
    if (!fc?.features) return [];
    return fc.features
      .filter((f) => {
        if (!onlyAvailable) return true;
        const s = (f.properties?.status || "").toLowerCase();
        return s === "available";
      })
      .map((f) => {
        const p = f.properties || {};
        const c = centroidOfFeature(f);
        const idRaw = p.id ?? p.uid;
        return {
          id: idRaw != null ? String(idRaw) : undefined,
          plot_name: p.plot_name,
          plot_type: p.plot_type,
          size_sqm: p.size_sqm,
          status: p.status,
          lat: c ? c[0] : null,
          lng: c ? c[1] : null,
          _feature: f,
        };
      });
  }, [fc, onlyAvailable]);

  const markers = useMemo(
    () =>
      rows
        .filter((r) => r.lat != null && r.lng != null)
        .map((r) => ({
          id: r.id,
          position: { lat: r.lat, lng: r.lng },
          title: `${r.plot_name ?? ""} (${r.status ?? ""})`,
          label: r.plot_name ? r.plot_name[0].toUpperCase() : undefined,
        })),
    [rows]
  );
const plotPolygons = useMemo(() => {
  if (!fc?.features) return [];

  return fc.features
    .map((f) => {
      const geom = f.geometry;
      if (!geom) return null;

      let coords = [];

      if (geom.type === "Polygon") {
        const outer = geom.coordinates?.[0] || [];
        coords = outer
          .map(([lng, lat]) =>
            typeof lat === "number" && typeof lng === "number"
              ? { lat, lng }
              : null
          )
          .filter(Boolean);
      } else if (geom.type === "MultiPolygon") {
        // take first ring of first polygon
        const outer = geom.coordinates?.[0]?.[0] || [];
        coords = outer
          .map(([lng, lat]) =>
            typeof lat === "number" && typeof lng === "number"
              ? { lat, lng }
              : null
          )
          .filter(Boolean);
      } else {
        // ignore Point/LineString/etc for polygons
        return null;
      }

      if (!coords.length) return null;

      const props = f.properties || {};
      const status = (props.status || "").toLowerCase();

      let fillColor = "#10b981"; // available
      if (status === "reserved") fillColor = "#f59e0b";
      else if (status === "occupied") fillColor = "#ef4444";

      return {
        id: props.id ?? props.uid ?? undefined,
        path: coords,
        options: {
          strokeColor: fillColor,
          strokeOpacity: 1,
          strokeWeight: 1.2,
          fillColor,
          fillOpacity: 0.5,
        },
      };
    })
    .filter(Boolean);
}, [fc]);
const roadLines = useMemo(() => {
  if (!roadsFc?.features) return [];

  return roadsFc.features
    .map((f) => {
      const g = f.geometry;
      if (!g) return null;

      let coords = [];

      if (g.type === "LineString") {
        coords =
          g.coordinates?.map(([lng, lat]) =>
            typeof lat === "number" && typeof lng === "number"
              ? { lat, lng }
              : null
          ) || [];
      } else if (g.type === "MultiLineString") {
        coords = (g.coordinates || []).flatMap((seg) =>
          (seg || []).map(([lng, lat]) =>
            typeof lat === "number" && typeof lng === "number"
              ? { lat, lng }
              : null
          )
        );
      } else {
        return null;
      }

      coords = coords.filter(Boolean);
      if (!coords.length) return null;

      const props = f.properties || {};

      return {
        id: props.id ?? props.uid ?? undefined,
        path: coords,
        options: {
          strokeColor: "#facc15", // bright yellow
          strokeOpacity: 1,
          strokeWeight: 3,
        },
      };
    })
    .filter(Boolean);
}, [roadsFc]);

  const onRowClick = (row) => {
    if (row.lat != null && row.lng != null) {
      setMapCenter({ lat: row.lat, lng: row.lng });
      setMapZoom((z) => (z < 19 ? 19 : z));
    }
  };

  // ---- Dialog open helpers ----
  const openView = (r) => {
    setModalRow(r);
    setViewOpen(true);
  };
  const openEdit = (r) => {
    // Normalize data for the edit form (stringify lat/lng to fixed precision)
    const prep = {
      id: r?.id ?? r?._feature?.properties?.id ?? "",
      uid: r?._feature?.properties?.uid ?? "",
      plot_name: r?.plot_name ?? r?._feature?.properties?.plot_name ?? "",
      status: r?.status ?? r?._feature?.properties?.status ?? "",
      plot_type: r?.plot_type ?? r?._feature?.properties?.plot_type ?? "",
      size_sqm: r?.size_sqm ?? r?._feature?.properties?.size_sqm ?? "",
      latitude: r?.lat != null ? r.lat.toFixed(6) : "",
      longitude: r?.lng != null ? r.lng.toFixed(6) : "",
    };
    setModalRow(prep);
    setEditOpen(true);
  };
  const openAdd = () => {
    setModalRow({
      plot_name: "",
      plot_type: "",
      status: "available",
      size_sqm: "",
      latitude: "",
      longitude: "",
    });
    setAddOpen(true);
  };

  // ---- Submit handlers ----
  const handleEditSubmit = async (payload) => {
    try {
      await editPlot(payload);
      toast.success("Plot updated successfully.");
      await fetchPlots();
      setEditOpen(false);
    } catch (err) {
      toast.error(err?.message || "Failed to update plot.");
    }
  };

  const handleAddSubmit = async (payload) => {
    try {
      await addPlot(payload);
      toast.success("Plot added successfully.");
      await fetchPlots();
      setAddOpen(false);
    } catch (err) {
      toast.error(err?.message || "Failed to add plot.");
    }
  };

  // ---- Delete (with shadcn AlertDialog) ----
  const requestDelete = async (id) => {
    if (!token) throw new Error("You're not authenticated. Please sign in again.");
    const url = `${API_BASE}/admin/delete-plot/${encodeURIComponent(id)}`;

    let res = await fetch(url, { method: "DELETE", headers: { ...authHeader } }).catch(
      () => null
    );

    if (!res || !res.ok) {
      // some backends keep a GET fallback
      res = await fetch(url, { method: "GET", headers: { ...authHeader } }).catch(
        () => null
      );
    }

    if (!res || !res.ok) {
      if (res && (res.status === 401 || res.status === 403)) {
        throw new Error("Permission denied. Please sign in with an admin account.");
      }
      const msg = res ? await res.text().catch(() => "") : "Network error";
      throw new Error(msg || "Failed to delete plot.");
    }
    try {
      return await res.json();
    } catch {
      return {};
    }
  };

  const confirmDelete = (row) => {
    const id =
      row?.id ?? row?._feature?.properties?.id ?? row?._feature?.properties?.uid;
    if (!id) {
      toast.error("Missing plot ID. Cannot delete.");
      return;
    }
    setConfirmId(id);
    setConfirmOpen(true);
  };

  const mainMapVisible = !addOpen && !editOpen;

  return (
    <div className="p-6 space-y-6">
      {/* shadcn sonner toasts */}
      <Toaster richColors expand={false} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Burial Plots</h1>
          <p className="text-sm text-muted-foreground">
            View, manage, and map cemetery plot inventory.
          </p>
        </div>
        <Button onClick={openAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add Plot
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <Alert variant="destructive" className="border-rose-200">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Failed to load plots</AlertTitle>
          <AlertDescription className="break-words">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div></div>
          <div className="flex items-center gap-2">
            <span className="text-sm">Only Available</span>
            <Switch checked={onlyAvailable} onCheckedChange={setOnlyAvailable} />
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
            <Table className="min-w-full">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-[22%]">Plot Name</TableHead>
                  <TableHead className="w-[18%]">Type</TableHead>
                  <TableHead className="w-[16%]">Size (sqm)</TableHead>
                  <TableHead className="w-[14%]">Status</TableHead>
                  <TableHead className="w-[20%]">Coordinates</TableHead>
                  <TableHead className="w-[1%] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground py-6"
                    >
                      No plots to display.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r, idx) => {
                    const s = (r.status || "").toLowerCase();
                    const badgeVariant =
                      s === "available"
                        ? "success"
                        : s === "reserved"
                        ? "warning"
                        : s === "occupied"
                        ? "destructive"
                        : "secondary";

                    return (
                      <TableRow
                        key={r.id ?? `${r.plot_name}-${idx}`}
                        onClick={() => onRowClick(r)}
                        className="cursor-pointer"
                      >
                        <TableCell>{r.plot_name ?? "-"}</TableCell>
                        <TableCell>{r.plot_type ?? "-"}</TableCell>
                        <TableCell className="tabular-nums">
                          {r.size_sqm ?? "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badgeVariant}>{r.status ?? "-"}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.lat != null && r.lng != null
                            ? `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              openView(r);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-1" /> View
                          </Button>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(r);
                            }}
                          >
                            <Pencil className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              confirmDelete(r);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-1" /> Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Main Map — hidden while Add/Edit modal is open */}
      {mainMapVisible && (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Map</CardTitle>
            <CardDescription>Interactive burial plot map</CardDescription>
          </CardHeader>
          <CardContent className="h-[60vh]">
            <div className="h-full rounded-md overflow-hidden border">
          <CemeteryMap
  center={mapCenter}
  zoom={mapZoom}
  clickable={false}
  showGeofence={true}
  restrictToGeofence={true}
  markers={[]}                 // no pins
  polygons={plotPolygons}      // green graves
  polylines={roadLines}        // 👈 yellow roads from road_plots
/>


            </div>
          </CardContent>
        </Card>
      )}

      {/* View Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>View Plot</DialogTitle>
            <DialogDescription>Details of the selected plot</DialogDescription>
          </DialogHeader>
          {modalRow && (
            <div className="grid gap-3 text-sm">
              <div>
                <strong>Name:</strong> {modalRow.plot_name ?? "—"}
              </div>
              <div>
                <strong>Type:</strong> {modalRow.plot_type ?? "—"}
              </div>
              <div>
                <strong>Size:</strong> {modalRow.size_sqm ?? "—"} sqm
              </div>
              <div>
                <strong>Status:</strong> {modalRow.status ?? "—"}
              </div>
              <div>
                <strong>Coords:</strong>{" "}
                {modalRow.lat != null && modalRow.lng != null
                  ? `${modalRow.lat.toFixed(6)}, ${modalRow.lng.toFixed(6)}`
                  : "—"}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog (with its own focused map) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Edit Plot</DialogTitle>
            <DialogDescription>Update burial plot details</DialogDescription>
          </DialogHeader>
          {modalRow && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const payload = {
                  id: modalRow.id ?? "",
                  uid: modalRow.uid ?? "",
                  plot_name: (modalRow.plot_name ?? "").toString().trim(),
                  status: (modalRow.status ?? "").toString().trim(),
                  plot_type: (modalRow.plot_type ?? "").toString().trim(),
                  size_sqm:
                    modalRow.size_sqm === "" ? null : Number(modalRow.size_sqm),
                  latitude:
                    modalRow.latitude === ""
                      ? null
                      : Number.parseFloat(String(modalRow.latitude)),
                  longitude:
                    modalRow.longitude === ""
                      ? null
                      : Number.parseFloat(String(modalRow.longitude)),
                };
                handleEditSubmit(payload);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Id</Label>
                  <Input
                    value={modalRow.id ?? ""}
                    readOnly
                    className="text-slate-500 border-slate-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Uid</Label>
                  <Input
                    value={modalRow.uid ?? ""}
                    readOnly
                    className="text-slate-500 border-slate-200"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Plot Name</Label>
                  <Input
                    value={modalRow.plot_name ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, plot_name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <select
                    value={modalRow.status ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, status: e.target.value }))
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-0"
                  >
                    <option value="">— Select Status —</option>
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="occupied">Occupied</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Plot Type</Label>
                  <Input
                    value={modalRow.plot_type ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, plot_type: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Size Sqm</Label>
                  <Input
                    type="number"
                    value={modalRow.size_sqm ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, size_sqm: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Latitude</Label>
                  <Input
                    type="number"
                    value={modalRow.latitude ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, latitude: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Longitude</Label>
                  <Input
                    type="number"
                    value={modalRow.longitude ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, longitude: e.target.value }))
                    }
                  />
                </div>
              </div>

              {/* Modal-embedded map for picking coordinates */}
              <div className="space-y-2">
                <Label>Pick Location on Map</Label>
                <div className="h-72 rounded-md overflow-hidden border">
                  <CemeteryMap
                    center={
                      modalRow.latitude && modalRow.longitude
                        ? {
                            lat: Number(modalRow.latitude),
                            lng: Number(modalRow.longitude),
                          }
                        : GOOGLE_CENTER
                    }
                    zoom={modalRow.latitude && modalRow.longitude ? 20 : 19}
                    clickable={true}
                    restrictToGeofence={true}
                    onCoordinatePick={({ lat, lng }) => {
                      setModalRow((m) =>
                        m
                          ? {
                              ...m,
                              latitude: lat.toFixed(6),
                              longitude: lng.toFixed(6),
                            }
                          : m
                      );
                    }}
                    onClickOutsideGeofence={() =>
                      toast.error("Selected point is outside the cemetery boundary.")
                    }
                    markers={
                      modalRow.latitude &&
                      modalRow.longitude &&
                      Number.isFinite(Number(modalRow.latitude)) &&
                      Number.isFinite(Number(modalRow.longitude))
                        ? [
                            {
                              id: "edit-plot-marker",
                              position: {
                                lat: Number(modalRow.latitude),
                                lng: Number(modalRow.longitude),
                              },
                            },
                          ]
                        : []
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Click inside the green boundary to set coordinates.
                </p>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Dialog (with its own focused map) */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Add New Plot</DialogTitle>
            <DialogDescription>Create a new burial plot record</DialogDescription>
          </DialogHeader>
          {modalRow && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const payload = {
                  plot_name: (modalRow.plot_name ?? "").toString().trim(),
                  status: (modalRow.status ?? "").toString().trim(),
                  plot_type: (modalRow.plot_type ?? "").toString().trim(),
                  size_sqm:
                    modalRow.size_sqm === "" ? null : Number(modalRow.size_sqm),
                  latitude:
                    modalRow.latitude === ""
                      ? null
                      : Number.parseFloat(String(modalRow.latitude)),
                  longitude:
                    modalRow.longitude === ""
                      ? null
                      : Number.parseFloat(String(modalRow.longitude)),
                };
                handleAddSubmit(payload);
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plot Name</Label>
                  <Input
                    value={modalRow.plot_name ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, plot_name: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <select
                    value={modalRow.status ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, status: e.target.value }))
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 focus-visible:ring-offset-0"
                  >
                    <option value="">— Select Status —</option>
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="occupied">Occupied</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Plot Type</Label>
                  <Input
                    value={modalRow.plot_type ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, plot_type: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Size Sqm</Label>
                  <Input
                    type="number"
                    value={modalRow.size_sqm ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, size_sqm: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Latitude</Label>
                  <Input
                    type="number"
                    value={modalRow.latitude ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, latitude: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Longitude</Label>
                  <Input
                    type="number"
                    value={modalRow.longitude ?? ""}
                    onChange={(e) =>
                      setModalRow((m) => ({ ...m, longitude: e.target.value }))
                    }
                  />
                </div>
              </div>

              {/* Modal-embedded map for picking coordinates */}
              <div className="space-y-2">
                <Label>Pick Location on Map</Label>
                <div className="h-72 rounded-md overflow-hidden border">
                  <CemeteryMap
                    center={
                      modalRow.latitude && modalRow.longitude
                        ? {
                            lat: Number(modalRow.latitude),
                            lng: Number(modalRow.longitude),
                          }
                        : GOOGLE_CENTER
                    }
                    zoom={modalRow.latitude && modalRow.longitude ? 20 : 19}
                    clickable={true}
                    restrictToGeofence={true}
                    onCoordinatePick={({ lat, lng }) => {
                      setModalRow((m) =>
                        m
                          ? {
                              ...m,
                              latitude: lat.toFixed(6),
                              longitude: lng.toFixed(6),
                            }
                          : m
                      );
                    }}
                    onClickOutsideGeofence={() =>
                      toast.error("Selected point is outside the cemetery boundary.")
                    }
                    markers={
                      modalRow.latitude &&
                      modalRow.longitude &&
                      Number.isFinite(Number(modalRow.latitude)) &&
                      Number.isFinite(Number(modalRow.longitude))
                        ? [
                            {
                              id: "add-plot-marker",
                              position: {
                                lat: Number(modalRow.latitude),
                                lng: Number(modalRow.longitude),
                              },
                            },
                          ]
                        : []
                    }
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Click inside the green boundary to set coordinates.
                </p>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAddOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Add</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (shadcn AlertDialog) */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this plot?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. Do you want to proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              onClick={async () => {
                const id = confirmId;
                setConfirmOpen(false);
                setConfirmId(null);
                try {
                  await requestDelete(id);
                  toast.success("Plot deleted successfully.");
                  await fetchPlots();
                } catch (err) {
                  toast.error(err?.message || "Failed to delete plot.");
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
