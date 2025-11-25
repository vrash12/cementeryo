// frontend/src/views/staff/pages/BurialSchedule.jsx
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
import { Badge } from "../../../components/ui/badge";
import { ScrollArea } from "../../../components/ui/scroll-area";
import {
  Eye, Pencil, Trash2, Plus, Search, CalendarDays, UserCircle2, ShieldCheck,
} from "lucide-react";

// ✅ sonner toasts
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

const statusColor = (s) => {
  const v = String(s || "").toLowerCase();
  if (v === "confirmed") return "bg-emerald-600";
  if (v === "completed") return "bg-indigo-600";
  return "bg-slate-500";
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
const getFeatId = (f) => {
  const p = f?.properties || {};
  return p.id != null ? String(p.id) : (p.uid != null ? String(p.uid) : undefined);
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

/* -------------------------- page main -------------------------- */
export default function BurialSchedule() {
  const currentUser = useAuthUser();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  // dropdown data
  const [plots, setPlots] = useState([]);       // [{id, plot_name}]
  const [visitors, setVisitors] = useState([]); // [{id, full_name}]

  // map data (full GeoJSON)
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

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/staff/burial-schedules/`, {
        headers: authHeaders({ Accept: "application/json" }),
      });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      setRows(arr);
    } catch (e) {
      console.error("[burial-schedules] fetch error:", e);
      toast.error("Failed to load schedules.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPlots = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/staff/plots/available`, {
        headers: authHeaders({ Accept: "application/json" }),
      });
      const json = await res.json();
      setPlots(Array.isArray(json) ? json : []);
    } catch (e) {
      console.error("[plots] fetch error:", e);
      setPlots([]);
      toast.error("Failed to load available plots.");
    }
  }, []);

  const fetchVisitors = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/staff/visitors`, {
        headers: authHeaders({ Accept: "application/json" }),
      });
      const data = await res.json();
      const arr = (Array.isArray(data) ? data : []).map((v) => ({
        id: v.id,
        full_name: v.full_name ?? [v.first_name, v.last_name].filter(Boolean).join(" ") ?? "Unknown",
      }));
      setVisitors(arr);
    } catch (e) {
      console.error("[visitors] fetch error:", e);
      setVisitors([]);
      toast.error("Failed to load visitors.");
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
    fetchPlots();
    fetchVisitors();
    fetchPlotsGeo();
  }, [fetchList, fetchPlots, fetchVisitors, fetchPlotsGeo]);

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

  const onCreate = () => {
    setEditItem(null);
    setOpenForm(true);
  };
  const onEdit = (item) => {
    setEditItem(item);
    setOpenForm(true);
  };

  const onDelete = async (rowOrId) => {
    const id = typeof rowOrId === "object" ? (rowOrId.id ?? rowOrId.uid) : rowOrId;
    const who = typeof rowOrId === "object" ? rowOrId.deceased_name : null;

    try {
      const res = await fetch(`${API_BASE}/staff/burial-schedules/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(await res.text());

      toast.success(`Schedule${who ? ` for “${who}”` : ""} deleted.`);
      setConfirmDelete(null);
      fetchList();
      fetchPlots();
      fetchPlotsGeo();
    } catch (e) {
      console.error("delete error:", e);
      toast.error("Failed to delete schedule.");
    }
  };

  const approverName = `${currentUser?.first_name ?? ""} ${currentUser?.last_name ?? ""}`.trim();

  // highlight on the big map
  const highlightedPlotId = useMemo(() => {
    const id = hoveredRow?.plot_id ?? viewItem?.plot_id ?? null;
    return id != null ? String(id) : null;
  }, [hoveredRow, viewItem]);

  const baseStyle = useCallback((feature) => {
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
      {/* ✅ sonner toaster host */}
      <Toaster richColors expand={false} />

      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-2xl">Burial Schedule</CardTitle>
          <CardDescription>Manage schedules for upcoming burials.</CardDescription>
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
              <Plus className="h-4 w-4" /> Add Schedule
            </Button>
          </div>

          <Separator className="my-2" />

          {/* table */}
          <div className="rounded-lg border">
            <div className="grid grid-cols-12 px-4 py-3 text-xs font-medium text-slate-500">
              <div className="col-span-3">Deceased Name</div>
              <div className="col-span-3">Burial Date</div>
              <div className="col-span-2">Status</div>
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
                    <div className="col-span-3 flex items-center gap-2">
                      <CalendarDays className="h-4 w-4 text-slate-400" />
                      <span>{fmtDateLong(r.burial_date)}</span>
                    </div>
                    <div className="col-span-2">
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full text-white ${statusColor(r.status)}`}>
                        {normalizeStatus(r.status)}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-slate-400" />
                      <span className="truncate">{r.approved_by_name || r.approved_by || "—"}</span>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-2">
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
      <ViewModal item={viewItem} onOpenChange={(o) => !o && setViewItem(null)} />

      {/* Create / Edit modal (two columns: form | map) */}
      <UpsertModal
        open={openForm}
        onOpenChange={(v) => {
          setOpenForm(v);
          if (!v) setEditItem(null);
        }}
        item={editItem}
        plots={plots}
        visitors={visitors}
        currentUser={currentUser}
        fc={fc}
        onSaved={() => {
          setOpenForm(false);
          setEditItem(null);
          fetchList();
          fetchPlots();
          fetchPlotsGeo();
        }}
      />

      {/* Confirm Delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Schedule</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Are you sure you want to delete this burial schedule?
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
function Field({ label, children }) {
  return (
    <div className="grid grid-cols-4 gap-3 items-start">
      <Label className="text-slate-500 col-span-1">{label}</Label>
      <div className="col-span-3 break-words">{children}</div>
    </div>
  );
}

function ViewModal({ item, onOpenChange }) {
  const open = !!item;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Burial Schedule Details</DialogTitle>
          <DialogDescription>Full details for this schedule.</DialogDescription>
        </DialogHeader>
        {item ? (
          <div className="space-y-4">
            <Field label="Deceased Name"><Badge variant="secondary">{item.deceased_name || "—"}</Badge></Field>
            <Field label="Plot">{item.plot_name || item.plot_id || "—"}</Field>
            <Field label="Family Contact">{item.family_contact_name || item.family_contact || "—"}</Field>
            <Field label="Birth Date">{fmtDateLong(item.birth_date || item.bith_date)}</Field>
            <Field label="Death Date">{fmtDateLong(item.death_date)}</Field>
            <Field label="Burial Date">{fmtDateLong(item.burial_date)}</Field>
            <Field label="Status">
              <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full text-white ${statusColor(item.status)}`}>
                {normalizeStatus(item.status)}
              </span>
            </Field>
            <Field label="Approved By">{item.approved_by_name || item.approved_by || "—"}</Field>
            <Field label="Special Requirements"><div className="whitespace-pre-wrap text-slate-700">{item.special_requirements || "—"}</div></Field>
            <Field label="Memorial Text"><div className="whitespace-pre-wrap text-slate-700">{item.memorial_text || "—"}</div></Field>
            <Separator />
            <div className="text-xs text-slate-400">
              Created: {fmtDateLong(item.created_at)} • Updated: {fmtDateLong(item.updated_at)}
            </div>
          </div>
        ) : null}
        <DialogFooter><Button onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------- create / edit modal (form | map) ----------------------- */
function UpsertModal({ open, onOpenChange, item, onSaved, plots, visitors, currentUser, fc }) {
  const isEdit = !!item;
  const [saving, setSaving] = useState(false);
  const modalMapRef = useRef(null);

  const [form, setForm] = useState(() => ({
    deceased_name: "",
    plot_id: "",
    family_contact: "",
    birth_date: "",
    death_date: "",
    burial_date: "",
    approved_by: currentUser?.id ?? "",
    special_requirements: "",
    memorial_text: "",
  }));

  useEffect(() => {
    if (isEdit) {
      setForm({
        deceased_name: item.deceased_name ?? "",
        plot_id: item.plot_id ?? "",
        family_contact: item.family_contact ?? "",
        birth_date: item.birth_date ?? item.bith_date ?? "",
        death_date: item.death_date ?? "",
        burial_date: item.burial_date ?? "",
        approved_by: item.approved_by ?? currentUser?.id ?? "",
        special_requirements: item.special_requirements ?? "",
        memorial_text: item.memorial_text ?? "",
      });
    } else {
      setForm((f) => ({ ...f, approved_by: currentUser?.id ?? "" }));
    }
  }, [isEdit, item, currentUser?.id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // fly to selected plot on the modal map
  useEffect(() => {
    if (!modalMapRef.current || !fc || !form.plot_id) return;
    const id = String(form.plot_id);
    const feat = (fc.features || []).find((f) => getFeatId(f) === id);
    if (feat) {
      const c = centerOf(feat);
      if (c) modalMapRef.current.flyTo(c, Math.max(modalMapRef.current.getZoom(), 19), { duration: 0.5 });
    }
  }, [form.plot_id, fc]);

  const submit = async () => {
    setSaving(true);
    try {
      const payload = { ...form, status: isEdit ? undefined : "Confirmed" };
      const url = isEdit
        ? `${API_BASE}/staff/burial-schedules/${encodeURIComponent(item.id ?? item.uid)}`
        : `${API_BASE}/staff/burial-schedules`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: authHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(await res.text());

      const data = await res.json().catch(() => ({}));
      toast.success(isEdit ? "Schedule updated successfully." : "Schedule created successfully.");
      onSaved?.(data);
    } catch (e) {
      console.error("save error:", e);
      toast.error(isEdit ? "Failed to update schedule." : "Failed to create schedule.");
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
          <DialogTitle>{isEdit ? "Edit Burial Schedule" : "Add Burial Schedule"}</DialogTitle>
          <DialogDescription>Fill in the details then save. The map highlights the selected plot.</DialogDescription>
        </DialogHeader>

        {/* Two columns: form | map */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* LEFT: form */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Deceased Name</Label>
              <Input
                value={form.deceased_name}
                onChange={(e) => set("deceased_name", e.target.value)}
                placeholder="e.g. Hazel Emphasis"
              />
            </div>

            <div className="space-y-2">
              <Label>Plot</Label>
              <Select value={String(form.plot_id || "")} onValueChange={(v) => set("plot_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select plot" /></SelectTrigger>
                <SelectContent>
                  {Array.isArray(plots) && plots.length > 0 ? (
                    plots.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.plot_name}</SelectItem>
                    ))
                  ) : (
                    <div className="px-2 py-1.5 text-sm text-slate-500">No available plots</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Family Contact</Label>
              <Select value={String(form.family_contact || "")} onValueChange={(v) => set("family_contact", v)}>
                <SelectTrigger><SelectValue placeholder="Select family contact" /></SelectTrigger>
                <SelectContent>
                  {Array.isArray(visitors) && visitors.length > 0 ? (
                    visitors.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>{v.full_name}</SelectItem>
                    ))
                  ) : (
                    <div className="px-2 py-1.5 text-sm text-slate-500">No visitors found</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Approved By</Label>
              <Input value={approverName || "—"} disabled />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Birth Date</Label>
                <Input type="date" value={form.birth_date?.slice(0, 10) || ""} onChange={(e) => set("birth_date", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Death Date</Label>
                <Input type="date" value={form.death_date?.slice(0, 10) || ""} onChange={(e) => set("death_date", e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Burial Date</Label>
              <Input type="date" value={form.burial_date?.slice(0, 10) || ""} onChange={(e) => set("burial_date", e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Special Requirements</Label>
              <textarea
                className="w-full min-h-[84px] rounded-md border bg-transparent p-2 text-sm"
                value={form.special_requirements}
                onChange={(e) => set("special_requirements", e.target.value)}
                placeholder="e.g., religious rites, flowers, accessibility, etc."
              />
            </div>

            <div className="space-y-2">
              <Label>Memorial Text</Label>
              <textarea
                className="w-full min-h-[84px] rounded-md border bg-transparent p-2 text-sm"
                value={form.memorial_text}
                onChange={(e) => set("memorial_text", e.target.value)}
                placeholder="Optional inscription"
              />
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
            <p className="text-xs text-muted-foreground">Selecting a plot highlights it on the map.</p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? (isEdit ? "Saving…" : "Creating…") : (isEdit ? "Save Changes" : "Create Schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
