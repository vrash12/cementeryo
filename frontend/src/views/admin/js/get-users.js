const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE_URL) || "";

function getAuth() {
  try {
    const raw = localStorage.getItem("auth");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function getUsers() {
  const auth = getAuth();
  if (!auth?.token) {
    return { ok: false, error: "Not authenticated." };
  }

  try {
    const res = await fetch(`${API_BASE}/superadmin/users`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }

    return { ok: true, data: data.users || [] };
  } catch (err) {
    return { ok: false, error: err?.message || "Network error" };
  }
}
