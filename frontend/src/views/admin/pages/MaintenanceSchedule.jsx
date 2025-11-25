// frontend/src/views/staff/pages/MaintenanceSchedules.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "../../../components/ui/card";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Separator } from "../../../components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "../../../components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "../../../components/ui/select";
import { ScrollArea } from "../../../components/ui/scroll-area";
import {
  Eye, Pencil, Trash2, Plus, Search, CalendarDays, UserCircle2, ShieldCheck,
} from "lucide-react";

// ✅ toasts
import { Toaster, toast } from "sonner";

// leaflet
import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "";

/* --------------------------- auth helpers --------------------------- */
function readAuth() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("auth");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function getToken() {
  const auth = readAuth();
  return auth?.accessToken || auth?.token || auth?.jwt || null;
}
function authHeaders(extra = {}) {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}
function useAuthUser() {
  const auth = readAuth();
  return useMemo(() => auth?.user ?? null, [auth]);
}

/* --------------------------- other helpers --------------------------- */
const fmtDateLong = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
};
const fmtDateShort = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
};
const statusColor = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "confirmed") return "bg-emerald-600 text-white";
  if (v === "completed") return "bg-indigo-600 text-white";
  return "bg-slate-500 text-white";
};
const normalizeStatus = (raw) => {
  if (!raw) return "Confirmed";
  const n = String(raw).toLowerCase();
  if (n === "completed") return "Completed";
  if (n === "confirmed") return "Confirmed";
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/* --------------------------- leaflet helpers --------------------------- */
const CEMETERY_CENTER = [15.49492, 120.55533];

/** Match whatever your GeoJSON uses for the plot identifier */
const getFeatId = (f) => {
  const p = f?.properties || {};
  // Try common keys (adjustable)
  return [
    p.plot_id, p.id, p.uid, p.gid, p.plotid, p.plotId, p.PLOT_ID,
  ].find((v) => v !== undefined && v !== null)?.toString();
};

const centerOf = (feature) => {
  try {
    if (!feature?.geometry) return null;
    if (feature.geometry.type === "Point") {
      const [lng, lat] = feature.geometry.coordinates || [];
      if (typeof lat === "number" && typeof lng === "number") return [lat, lng];
      return null;
    }
    const b = L.geoJSON(feature).getBounds().getCenter();
    return [b.lat, b.lng];
  } catch { return null; }
};

/* =======================================================================
   PAGE: MaintenanceSchedules
========================================================================== */
export default function MaintenanceSchedules() {
  const currentUser = useAuthUser();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  // dropdown data (burial records with plot_id inside)
  const [graves, setGraves] = useState([]);
  // map data
  const [fc, setFc] = useState(null);
  const [geoKey, setGeoKey] = useState(0);
  const tableMapRef = useRef(null);

  const [hoveredRow, setHoveredRow] = useState(null);

  // modals
  const [viewItem, setViewItem] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [openForm, setOpenForm] = useState(false);
  const isAnyModalOpen = openForm || !!viewItem || !!confirmDelete;

  /* --------------------------- fetchers --------------------------- */
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/staff/maintenance-schedules`, {
        headers: authHeaders({ Accept: "application/json" }),
      });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setRows(arr);
    } catch (e) {
      console.error("[maintenance-schedules] fetch error:", e);
      toast.error("Failed to load maintenance schedules.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchGraves = useCallback(async () => {
    try {
      // ⬇️ make sure this endpoint returns grave objects with a valid plot_id
      const res = await fetch(`${API_BASE}/graves/graves`, {
        headers: authHeaders({ Accept: "application/json" }),
      });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setGraves(arr);
    } catch (e) {
      console.error("[graves] fetch error:", e);
      setGraves([]);
      toast.error("Failed to load burial records.");
    }
  }, []);

  const fetchPlotsGeo = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/plot/`, { headers: authHeaders() });
      const json = await res.json();
      setFc(json || null);
      setGeoKey((k) => k + 1);
    } catch (e) {
      console.error("[plot geojson] fetch error:", e);
      setFc(null);
      toast.error("Failed to load plot map.");
    }
  }, []);

  useEffect(() => {
    fetchList();
    fetchGraves();
    fetchPlotsGeo();
  }, [fetchList, fetchGraves, fetchPlotsGeo]);

  /* --------------------------- filters --------------------------- */
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const passQ =
        !needle ||
        String(r.deceased_name || "").toLowerCase().includes(needle) ||
        String(r.approved_by_name || r.approved_by || "").toLowerCase().includes(needle);
      const passStatus =
        statusFilter === "All" ||
        String(r.status || "").toLowerCase() === statusFilter.toLowerCase();
      return passQ && passStatus;
    });
  }, [rows, q, statusFilter]);

  /* --------------------------- actions --------------------------- */
  const onCreate = () => {
    setEditItem(null);
    setOpenForm(true);
  };
  const onEdit = (item) => {
    setEditItem(item);
    setOpenForm(true);
  };

  const deleteHit = async (id) => {
    // Prefer DELETE /staff/delete-maintenance/:id; fallback to body if backend expects it.
    const tryUrlParam = async () => {
      const res = await fetch(`${API_BASE}/staff/delete-maintenance/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      return res;
    };
    const tryBody = async () => {
      const res = await fetch(`${API_BASE}/staff/delete-maintenance`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id }),
      });
      return res;
    };
    let res = await tryUrlParam();
    if (!res.ok) res = await tryBody();
    return res;
  };

  const onDelete = async (rowOrId) => {
    const id = typeof rowOrId === "object" ? (rowOrId.id ?? rowOrId.uid) : rowOrId;
    const who = typeof rowOrId === "object" ? rowOrId.deceased_name : null;

    try {
      const res = await deleteHit(id);
      if (!res.ok) throw new Error(await res.text());

      toast.success(`Maintenance schedule${who ? ` for “${who}”` : ""} deleted.`);
      setConfirmDelete(null);
      fetchList();
      fetchPlotsGeo();
    } catch (e) {
      console.error("delete error:", e);
      toast.error("Failed to delete schedule.");
    }
  };

  // highlight on main map
  const highlightedPlotId = useMemo(() => {
    const id = hoveredRow?.plot_id ?? viewItem?.plot_id ?? null;
    return id != null ? String(id) : null;
  }, [hoveredRow, viewItem]);

  const baseStyle = useCallback(() => {
    return { color: "#94a3b8", weight: 2, opacity: 0.35, fillOpacity: 0.08 };
  }, []);
  const styleWithHighlight = useCallback((feature) => {
    const fid = getFeatId(feature);
    if (highlightedPlotId && fid === String(highlightedPlotId)) {
      return { color: "#0ea5e9", weight: 4, opacity: 1, fillOpacity: 0.2 };
    }
    return baseStyle(feature);
  }, [highlightedPlotId, baseStyle]);

  useEffect(() => {
    if (!tableMapRef.current || !fc || !highlightedPlotId) return;
    const feat = (fc.features || []).find((f) => getFeatId(f) === String(highlightedPlotId));
    if (feat) {
      const c = centerOf(feat);
      if (c) tableMapRef.current.flyTo(c, Math.max(tableMapRef.current.getZoom(), 19), { duration: 0.6 });
    }
  }, [highlightedPlotId, fc]);

  return (
    <div className="w-full">
      <Toaster richColors expand={false} />

      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">Maintenance Schedules</CardTitle>
          <CardDescription>Create and manage plot maintenance schedules.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* controls */}
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between mb-4">
            <div className="flex gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search deceased or approver…"
                  className="pl-8 w-[260px]"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="Confirmed">Confirmed</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={onCreate} className="gap-2">
              <Plus className="h-4 w-4" /> Add Maintenance
            </Button>
          </div>

          <Separator className="my-2" />

          {/* table */}
          <div className="rounded-lg border">
            <div className="grid grid-cols-12 px-4 py-3 text-xs font-medium text-slate-500">
              <div className="col-span-3">Deceased Name</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-3">Maintenance Date</div>
              <div className="col-span-2">Approved By</div>
              <div className="col-span-2 text-right pr-1">Actions</div>
            </div>
            <Separator />
            <ScrollArea className="max-h-[56vh]">
              {loading ? (
                <div className="p-6 text-sm text-slate-500">Loading schedules…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No schedules found.</div>
              ) : (
                filtered.map((r) => (
                  <div
                    key={r.id ?? r.uid ?? Math.random()}
                    className="grid grid-cols-12 items-center px-4 py-3 text-sm hover:bg-slate-50"
                    onMouseEnter={() => setHoveredRow(r)}
                    onMouseLeave={() => setHoveredRow(null)}
                  >
                    <div className="col-span-3 flex items-center gap-2">
                      <UserCircle2 className="h-4 w-4 text-slate-400" />
                      <span className="truncate">{r.deceased_name || "—"}</span>
                    </div>
                    <div className="col-span-2">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${statusColor(r.status)}`}>
                        {normalizeStatus(r.status)}
                      </span>
                    </div>
                    <div className="col-span-3 flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-slate-400" />
                      <span>{fmtDateLong(r.maintenance_date)}</span>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-slate-400" />
                      <span className="truncate">{r.approved_by_name || r.approved_by || "—"}</span>
                    </div>
                    {/* row actions */}
                    <div className="col-span-12 flex items-center justify-end gap-2 mt-2">
                      <Button size="icon" variant="secondary" onClick={() => setViewItem(r)} title="View">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="outline" onClick={() => onEdit(r)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="destructive"
                        onClick={() => setConfirmDelete(r)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Separator className="col-span-12 mt-3" />
                  </div>
                ))
              )}
            </ScrollArea>
          </div>

          {/* Map under table — hidden when any modal is open */}
          <div className="mt-4 rounded-md overflow-hidden border">
            <div className="px-4 py-2 text-sm text-slate-500">Plot Map</div>
            {!isAnyModalOpen && (
              <div className="mt-4 h-[50vh]">
                <MapContainer
                  center={CEMETERY_CENTER}
                  zoom={19}
                  minZoom={16}
                  maxZoom={22}
                  whenCreated={(m) => (tableMapRef.current = m)}
                  style={{ width: "100%", height: "100%" }}
                >
                  <TileLayer
                    attribution="&copy; OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={22}
                  />
                  {fc && (
                    <GeoJSON
                      key={`table-map-${geoKey}-${highlightedPlotId ?? "none"}`}
                      data={fc}
                      style={styleWithHighlight}
                      onEachFeature={(feature, layer) => {
                        const p = feature.properties || {};
                        const html = `
                          <div style="min-width:200px;font-size:12.5px;line-height:1.35">
                            <div><strong>Plot ID:</strong> ${p.plot_id ?? p.id ?? "-"}</div>
                            <div><strong>Section:</strong> ${p.plot_name ?? "-"}</div>
                            <div><strong>Type:</strong> ${p.plot_type ?? "-"}</div>
                            <div><strong>Size:</strong> ${p.size_sqm ?? "-"} sqm</div>
                            <div><strong>Status:</strong> ${p.status ?? "-"}</div>
                          </div>`;
                        layer.bindPopup(html);
                      }}
                      pointToLayer={(feature, latlng) =>
                        L.circleMarker(latlng, { radius: 6, weight: 2, fillOpacity: 0.9, color: "#3b82f6" })
                      }
                    />
                  )}
                </MapContainer>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* View modal */}
      <ViewModal item={viewItem} onOpenChange={(o) => !o && setViewItem(null)} fc={fc} />

      {/* Create / Edit modal */}
      <UpsertModal
        open={openForm}
        onOpenChange={(v) => {
          setOpenForm(v);
          if (!v) setEditItem(null);
        }}
        item={editItem}
        graves={graves}
        currentUser={currentUser}
        fc={fc}
        onSaved={() => {
          setOpenForm(false);
          setEditItem(null);
          fetchList();
          fetchPlotsGeo();
        }}
      />

      {/* Confirm Delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Maintenance</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Delete this maintenance schedule?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => onDelete(confirmDelete?.id ?? confirmDelete?.uid)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------- view-only modal -------------------------- */
function Field({ label, children, hidden = false }) {
  if (hidden) return null;
  return (
    <div className="grid grid-cols-4 gap-3 items-start">
      <Label className="text-slate-500 col-span-1">{label}</Label>
      <div className="col-span-3 break-words">{children}</div>
    </div>
  );
}

function ViewModal({ item, onOpenChange, fc }) {
  const open = !!item;

  const viewMapRef = useRef(null);
  const highlightedPlotId = item?.plot_id != null ? String(item.plot_id) : null;

  const modalStyle = useCallback((feature) => {
    const fid = getFeatId(feature);
    if (highlightedPlotId && fid === highlightedPlotId) {
      return { color: "#0ea5e9", weight: 4, opacity: 1, fillOpacity: 0.2 };
    }
    return { color: "#94a3b8", weight: 2, opacity: 0.35, fillOpacity: 0.08 };
  }, [highlightedPlotId]);

  useEffect(() => {
    if (!viewMapRef.current || !fc || !highlightedPlotId) return;
    const feat = (fc.features || []).find((f) => getFeatId(f) === highlightedPlotId);
    if (feat) {
      const c = centerOf(feat);
      if (c) viewMapRef.current.flyTo(c, Math.max(viewMapRef.current.getZoom(), 19), { duration: 0.5 });
    }
  }, [highlightedPlotId, fc]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Maintenance Details</DialogTitle>
          <DialogDescription>Full details for this maintenance schedule.</DialogDescription>
        </DialogHeader>
        {item ? (
          <div className="space-y-4">
            <Field label="Deceased Name">
              <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-slate-100">
                {item.deceased_name || "—"}
              </span>
            </Field>
            <Field label="Status">
              <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full ${statusColor(item.status)}`}>
                {normalizeStatus(item.status)}
              </span>
            </Field>
            <Field label="Maintenance Date">{fmtDateLong(item.maintenance_date)}</Field>
            <Field label="Approved By">{item.approved_by_name || item.approved_by || "—"}</Field>
            <Field label="Created">{fmtDateLong(item.created_at)}</Field>
            <Field label="Family Contact">{item.family_contact || "—"}</Field>
            <Field label="Plot ID">{String(item.plot_id ?? "—")}</Field>

            <Separator />

            <div className="space-y-2">
              <Label className="text-slate-500">Plot Location</Label>
              <div className="h-[46vh] rounded-md overflow-hidden border">
                <MapContainer
                  center={CEMETERY_CENTER}
                  zoom={19}
                  minZoom={16}
                  maxZoom={22}
                  whenCreated={(m) => (viewMapRef.current = m)}
                  style={{ width: "100%", height: "100%" }}
                >
                  <TileLayer
                    attribution="&copy; OpenStreetMap contributors"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={22}
                  />
                  {fc && (
                    <GeoJSON
                      key={`view-map-${highlightedPlotId || "none"}`}
                      data={fc}
                      style={modalStyle}
                      pointToLayer={(feature, latlng) =>
                        L.circleMarker(latlng, { radius: 6, weight: 2, fillOpacity: 0.9, color: "#3b82f6" })
                      }
                    />
                  )}
                </MapContainer>
              </div>
            </div>
          </div>
        ) : null}
        <DialogFooter><Button onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------- create / edit modal (form | map) ----------------------- */
function UpsertModal({ open, onOpenChange, item, onSaved, graves, currentUser, fc }) {
  const isEdit = !!item;
  const modalMapRef = useRef(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(() => ({
    deceased_name: "",
    plot_id: "",
    plot_name: "",
    family_contact: "",
    maintenance_date: "",
    approved_by: currentUser?.id ?? "",
    status: "Confirmed",
  }));

  // when editing, load existing; otherwise set approver
  useEffect(() => {
    if (isEdit) {
      setForm({
        deceased_name: item.deceased_name ?? "",
        plot_id: item.plot_id ?? "",
        plot_name: item.plot_name ?? "",
        family_contact: item.family_contact ?? "",
        maintenance_date: item.maintenance_date ?? "",
        approved_by: item.approved_by ?? currentUser?.id ?? "",
        status: item.status ?? "Confirmed",
      });
    } else {
      setForm((f) => ({ ...f, approved_by: currentUser?.id ?? "" }));
    }
  }, [isEdit, item, currentUser?.id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // selecting a burial record MUST set plot_id (not grave id)
  const onPickGrave = (graveId) => {
    // graveId here is the *plot_id* we encoded in <SelectItem value=...>
    const g = graves?.find((x) => String(x.plot_id) === String(graveId));
    if (g) {
      setForm((f) => ({
        ...f,
        deceased_name: g.deceased_name ?? "",
        plot_id: g.plot_id ?? "",
        plot_name: g.plot_name ?? "",
        family_contact: g.family_contact ?? "",
      }));
    } else {
      // fallback: if Select gave us an id, try to map
      const byId = graves?.find((x) => String(x.id) === String(graveId));
      if (byId?.plot_id) {
        setForm((f) => ({
          ...f,
          deceased_name: byId.deceased_name ?? "",
          plot_id: byId.plot_id ?? "",
          plot_name: byId.plot_name ?? "",
          family_contact: byId.family_contact ?? "",
        }));
      } else {
        set("plot_id", graveId);
      }
    }
  };

  // fly to selected plot on map
  useEffect(() => {
    if (!modalMapRef.current || !fc || !form.plot_id) return;
    const id = String(form.plot_id);
    const feat = (fc.features || []).find((f) => getFeatId(f) === id);
    if (feat) {
      const c = centerOf(feat);
      if (c) modalMapRef.current.flyTo(c, Math.max(modalMapRef.current.getZoom(), 19), { duration: 0.5 });
    }
  }, [form.plot_id, fc]);

  const addHit = async (payload) => {
    const res = await fetch(`${API_BASE}/staff/add-maintenance`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(payload),
    });
    return res;
  };
  const editHit = async (id, payload) => {
    // Prefer /staff/edit-maintenance/:id ; fallback to body-only if server requires
    let res = await fetch(`${API_BASE}/staff/edit-maintenance/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      res = await fetch(`${API_BASE}/staff/edit-maintenance`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify({ id, ...payload }),
      });
    }
    return res;
  };

  const submit = async () => {
    setSaving(true);
    try {
      // ❗ Only pass what your table needs
      const payload = {
        plot_id: form.plot_id,
        maintenance_date: form.maintenance_date,
        status: form.status,
        approved_by: form.approved_by, // staff user id
      };

      // basic validation
      if (!payload.plot_id) throw new Error("Plot is required.");
      if (!payload.maintenance_date) throw new Error("Maintenance date is required.");
      if (!payload.approved_by) throw new Error("Approver is missing.");

      const res = isEdit
        ? await editHit(item.id ?? item.uid, payload)
        : await addHit(payload);

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json().catch(() => ({}));
      toast.success(isEdit ? "Maintenance updated successfully." : "Maintenance created successfully.");
      onSaved?.(data);
    } catch (e) {
      console.error("save error:", e);
      toast.error(e?.message || (isEdit ? "Failed to update maintenance." : "Failed to create maintenance."));
    } finally {
      setSaving(false);
    }
  };

  const approverName = `${currentUser?.first_name ?? ""} ${currentUser?.last_name ?? ""}`.trim();
  const highlightedId = String(form.plot_id || "");

  const modalStyle = useCallback((feature) => {
    const fid = getFeatId(feature);
    if (highlightedId && fid === highlightedId) {
      return { color: "#0ea5e9", weight: 4, opacity: 1, fillOpacity: 0.2 };
    }
    return { color: "#94a3b8", weight: 2, opacity: 0.35, fillOpacity: 0.08 };
  }, [highlightedId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Maintenance" : "Add Maintenance"}</DialogTitle>
          <DialogDescription>Select a burial record (ensures correct plot), set the date, then save. The selected plot is highlighted on the map.</DialogDescription>
        </DialogHeader>

        {/* Two columns: form | map */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT: form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Burial Record / Deceased</Label>
              <Select onValueChange={onPickGrave}>
                <SelectTrigger><SelectValue placeholder="Select burial record" /></SelectTrigger>
                <SelectContent>
                  {Array.isArray(graves) && graves.length > 0 ? (
                    graves.map((g) => (
                      // ⚠️ value = plot_id to guarantee map highlight & payload correctness
                      <SelectItem key={`${g.id}-${g.plot_id}`} value={String(g.plot_id ?? g.id)}>
                        {(g.deceased_name ?? "—") + (g.plot_name ? ` • ${g.plot_name}` : "")}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2 py-1.5 text-sm text-slate-500">No burial records found</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Deceased Name</Label>
              <Input value={form.deceased_name} onChange={(e) => set("deceased_name", e.target.value)} placeholder="Auto-filled from burial record" />
            </div>

            <div className="space-y-2">
              <Label>Plot ID</Label>
              <Input value={form.plot_id} onChange={(e) => set("plot_id", e.target.value)} placeholder="Auto-filled" />
            </div>

            <div className="space-y-2">
              <Label>Maintenance Date</Label>
              <Input
                type="date"
                value={form.maintenance_date?.slice(0, 10) || ""}
                onChange={(e) => set("maintenance_date", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Confirmed">Confirmed</SelectItem>
                  <SelectItem value="Completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Approved By</Label>
              <Input value={approverName || "—"} disabled />
            </div>
          </div>

          {/* RIGHT: map */}
          <div className="space-y-2 md:pl-1">
            <Label className="sr-only">Plot Map</Label>
            <div className="h-64 md:h-[520px] rounded-md overflow-hidden border">
              <MapContainer
                center={CEMETERY_CENTER}
                zoom={19}
                minZoom={16}
                maxZoom={22}
                whenCreated={(m) => (modalMapRef.current = m)}
                style={{ width: "100%", height: "100%" }}
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  maxZoom={22}
                />
                {fc && (
                  <GeoJSON
                    key={`modal-map-${highlightedId || "none"}`}
                    data={fc}
                    style={modalStyle}
                    pointToLayer={(feature, latlng) =>
                      L.circleMarker(latlng, { radius: 6, weight: 2, fillOpacity: 0.9, color: "#3b82f6" })
                    }
                    onEachFeature={(feature, layer) => {
                      const p = feature.properties || {};
                      const html = `
                        <div style="min-width:200px;font-size:12.5px;line-height:1.35">
                          <div><strong>Plot ID:</strong> ${p.plot_id ?? p.id ?? "-"}</div>
                          <div><strong>Section:</strong> ${p.plot_name ?? "-"}</div>
                          <div><strong>Type:</strong> ${p.plot_type ?? "-"}</div>
                          <div><strong>Size:</strong> ${p.size_sqm ?? "-"} sqm</div>
                          <div><strong>Status:</strong> ${p.status ?? "-"}</div>
                        </div>`;
                      layer.bindPopup(html);
                    }}
                  />
                )}
              </MapContainer>
            </div>
            <p className="text-xs text-muted-foreground">Selecting a burial record highlights its plot on the map.</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save Changes" : "Create Maintenance")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
