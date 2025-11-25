// frontend/src/views/visitor/pages/Inquire.jsx
import { useState, useMemo, useEffect } from "react";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Alert, AlertDescription } from "../../../components/ui/alert";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "";

export default function Inquire() {
  const authRaw = localStorage.getItem("auth");
  const auth = useMemo(() => {
    try {
      return authRaw ? JSON.parse(authRaw) : null;
    } catch {
      return null;
    }
  }, [authRaw]);

  const currentUser = auth?.user || {};
  const isVisitorLoggedIn = auth?.user && auth?.user.role === "visitor";

  // Today in YYYY-MM-DD (for max attribute and comparisons)
  const todayISO = useMemo(
    () => new Date().toISOString().slice(0, 10),
    []
  );

  const [formData, setFormData] = useState({
    requestType: "burial",
    deceasedName: "",
    birthDate: "",
    deathDate: "",
    burialDate: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });

  // Burial records for this visitor (for maintenance autofill)
  const [myBurialRecords, setMyBurialRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");

  const onChange = (e) => {
    setFormData((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  // Load this visitor's burial requests to use for maintenance dropdown
  useEffect(() => {
    if (!isVisitorLoggedIn || !currentUser.id) return;

    let cancelled = false;
    (async () => {
      try {
        setRecordsLoading(true);
        setRecordsError("");

        const headers = auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
        // ✅ use existing visitor route instead of /graves
        const res = await fetch(
          `${API_BASE}/visitor/my-burial-requests/${encodeURIComponent(currentUser.id)}`,
          { headers }
        );

        const ct = res.headers.get("content-type") || "";
        const body = ct.includes("application/json") ? await res.json() : await res.text();

        if (!res.ok) {
          const msg = typeof body === "string" ? body : JSON.stringify(body);
          throw new Error(msg || "Failed to load burial records.");
        }

        // visitor.controller returns { success, data: [...] }
        const list = Array.isArray(body) ? body : body?.data || [];
        const normalized = list
          .map((r) => {
            const id = r?.id ?? r?.uid ?? null;
            const deceased_name = r?.deceased_name ?? "";
            if (!id || !deceased_name) return null;

            return {
              id: String(id),
              deceased_name,
              birth_date: r?.birth_date ?? null,
              death_date: r?.death_date ?? null,
              burial_date: r?.burial_date ?? null,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.deceased_name.localeCompare(b.deceased_name));

        if (!cancelled) setMyBurialRecords(normalized);
      } catch (err) {
        if (!cancelled) {
          setRecordsError(err.message || "Failed to load burial records.");
        }
      } finally {
        if (!cancelled) setRecordsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [API_BASE, auth?.token, currentUser.id, isVisitorLoggedIn]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isVisitorLoggedIn) return;

    setMsg({ type: "", text: "" });

    // Basic checks
    if (!formData.deceasedName || !formData.deceasedName.trim()) {
      setMsg({ type: "error", text: "Please enter the deceased name." });
      return;
    }

    // For burial requests, dates are required
    if (formData.requestType === "burial") {
      const { birthDate, deathDate, burialDate } = formData;

      if (!birthDate || !deathDate || !burialDate) {
        setMsg({
          type: "error",
          text:
            "For a burial request, please complete Birth Date, Death Date, and Burial Date.",
        });
        return;
      }

      // Birth/death must NOT be in the future
      if (birthDate > todayISO) {
        setMsg({
          type: "error",
          text: "Birth date cannot be in the future.",
        });
        return;
      }

      if (deathDate > todayISO) {
        setMsg({
          type: "error",
          text: "Death date cannot be in the future.",
        });
        return;
      }

      // Sanity check that birth <= death
      if (birthDate && deathDate && birthDate > deathDate) {
        setMsg({
          type: "error",
          text: "Birth date cannot be after the death date.",
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const commonPayload = {
        deceased_name: formData.deceasedName,
        family_contact: currentUser.id,
      };

      const endpoint =
        formData.requestType === "burial"
          ? "/visitor/request-burial"
          : "/visitor/request-maintenance";

      const payload =
        formData.requestType === "burial"
          ? {
              ...commonPayload,
              birth_date: formData.birthDate,
              death_date: formData.deathDate,
              burial_date: formData.burialDate,
            }
          : commonPayload;

      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth?.token ? { Authorization: `Bearer ${auth.token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Request failed: ${res.status}`);

      const data = await res.json().catch(() => ({}));
      console.log("API response:", data);

      setMsg({
        type: "ok",
        text:
          formData.requestType === "burial"
            ? "Burial request submitted successfully!"
            : "Maintenance request submitted successfully!",
      });

      // Reset form
      setFormData({
        requestType: "burial",
        deceasedName: "",
        birthDate: "",
        deathDate: "",
        burialDate: "",
      });
      setSelectedRecordId("");
    } catch (err) {
      setMsg({
        type: "error",
        text: err.message || "Failed to submit request.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center font-poppins py-10 px-4">
      {/* global backdrop */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-100 via-cyan-50 to-blue-100" />
        <div className="absolute -top-24 -left-24 h-[32rem] w-[32rem] rounded-full bg-emerald-300/50 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute top-1/3 right-0 h-[28rem] w-[28rem] rounded-full bg-cyan-300/50 blur-3xl dark:bg-cyan-700/20" />
        <div className="absolute -bottom-32 left-1/4 h-[24rem] w-[24rem] rounded-full bg-blue-300/40 blur-3xl dark:bg-blue-700/20" />
      </div>

      <div className="relative w-full max-w-2xl space-y-4">
        {!isVisitorLoggedIn && (
          <Alert
            className="bg-rose-50/90 backdrop-blur border-rose-200 shadow-md"
            variant="destructive"
          >
            <AlertDescription className="text-rose-700">
              Please login to inquire a ticket.
            </AlertDescription>
          </Alert>
        )}

        {msg.text && (
          <Alert
            variant={msg.type === "error" ? "destructive" : "default"}
            className={
              msg.type === "error"
                ? "bg-rose-50/90 backdrop-blur border-rose-200 shadow-md"
                : "bg-emerald-50/90 backdrop-blur border-emerald-200 shadow-md"
            }
          >
            <AlertDescription
              className={msg.type === "error" ? "text-rose-700" : "text-emerald-700"}
            >
              {msg.text}
            </AlertDescription>
          </Alert>
        )}

        <div className="relative">
          {/* backdrop shadow */}
          <div className="absolute -inset-2 bg-gradient-to-br from-emerald-400/25 via-cyan-400/20 to-blue-400/25 rounded-2xl blur-xl opacity-40" />

          <Card className="relative overflow-hidden border-white/60 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-white/40 shadow-lg">
            {/* backdrop gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/20 via-cyan-400/15 to-blue-400/20" />

            <CardHeader className="relative">
              <CardTitle className="text-2xl font-bold text-emerald-700">
                Inquire a Ticket
              </CardTitle>
              <CardDescription className="text-slate-600">
                Please fill in the form below to request a burial schedule or maintenance
                service.
              </CardDescription>
            </CardHeader>
            <CardContent className="relative">
              <form className="space-y-6" onSubmit={handleSubmit}>
                {/* Request Type */}
                <div className="grid gap-2">
                  <Label>Request Type</Label>
                  <Select
                    value={formData.requestType}
                    onValueChange={(v) => {
                      setFormData((f) => ({
                        ...f,
                        requestType: v,
                        ...(v === "maintenance"
                          ? { birthDate: "", deathDate: "", burialDate: "" }
                          : {}),
                      }));
                      // reset maintenance selection when switching types
                      if (v !== "maintenance") {
                        setSelectedRecordId("");
                      }
                    }}
                    disabled={!isVisitorLoggedIn || submitting}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select request type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="burial">Burial Request</SelectItem>
                      <SelectItem value="maintenance">Maintenance Request</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Deceased info */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Deceased Name</Label>

                    {/* Maintenance: select from burial requests to autofill */}
                    {formData.requestType === "maintenance" && (
                      <>
                        <Select
                          value={selectedRecordId}
                          onValueChange={(val) => {
                            setSelectedRecordId(val);
                            const rec = myBurialRecords.find((r) => r.id === val);
                            if (rec) {
                              setFormData((f) => ({
                                ...f,
                                deceasedName: rec.deceased_name || "",
                              }));
                            }
                          }}
                          disabled={
                            !isVisitorLoggedIn ||
                            submitting ||
                            recordsLoading ||
                            myBurialRecords.length === 0
                          }
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                recordsLoading
                                  ? "Loading burial records..."
                                  : myBurialRecords.length
                                  ? "Select from burial records"
                                  : "No burial records found"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {myBurialRecords.map((rec) => {
                              const dateLabel = rec.burial_date
                                ? String(rec.burial_date).slice(0, 10)
                                : "";
                              const label = dateLabel
                                ? `${rec.deceased_name} (${dateLabel})`
                                : rec.deceased_name;
                              return (
                                <SelectItem key={rec.id} value={rec.id}>
                                  {label}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>

                        {recordsError && (
                          <p className="text-xs text-rose-600">{recordsError}</p>
                        )}
                      </>
                    )}

                    {/* Editable name field (autofilled when maintenance selection is used) */}
                    <Input
                      type="text"
                      name="deceasedName"
                      value={formData.deceasedName}
                      onChange={onChange}
                      placeholder="Full name"
                      disabled={!isVisitorLoggedIn || submitting}
                    />
                  </div>

                  {formData.requestType === "burial" && (
                    <>
                      <div>
                        <Label>Birth Date</Label>
                        <Input
                          type="date"
                          name="birthDate"
                          value={formData.birthDate}
                          onChange={onChange}
                          max={todayISO}
                          disabled={!isVisitorLoggedIn || submitting}
                        />
                      </div>
                      <div>
                        <Label>Death Date</Label>
                        <Input
                          type="date"
                          name="deathDate"
                          value={formData.deathDate}
                          onChange={onChange}
                          max={todayISO}
                          disabled={!isVisitorLoggedIn || submitting}
                        />
                      </div>
                      <div>
                        <Label>Burial Date</Label>
                        <Input
                          type="date"
                          name="burialDate"
                          value={formData.burialDate}
                          onChange={onChange}
                          disabled={!isVisitorLoggedIn || submitting}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Family Contact */}
                <div className="grid gap-2">
                  <Label>Family Contact</Label>
                  <Input
                    type="text"
                    value={`${currentUser.first_name || ""} ${
                      currentUser.last_name || ""
                    }`}
                    disabled
                  />
                </div>

                {/* Submit */}
                <Button
                  type="submit"
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700 shadow-md hover:shadow-lg transition-all"
                  disabled={!isVisitorLoggedIn || submitting}
                >
                  {submitting ? "Submitting..." : "Submit Request"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
