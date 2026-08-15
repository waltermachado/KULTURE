import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

/**
 * Hook de autenticação.
 *
 * Estado:  { user, loading }
 * Ações:   login(email, pw), register({email, pw, name, cpf}), logout(), refreshToken()
 *
 * O accessToken fica em memória (não em localStorage).
 * O refresh token fica em cookie httpOnly (gerenciado pelo backend).
 * Refresh automático: na montagem tenta POST /api/auth/refresh (cookie já presente).
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(null);

  // Helper: fetch autenticado
  const authFetch = useCallback(async (path, opts = {}) => {
    const headers = { ...opts.headers };
    if (opts.body) headers["Content-Type"] = "application/json";
    if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
      credentials: "include" // envia cookies httpOnly
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.message || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = body?.code;
      throw err;
    }
    return body;
  }, []);

  // Refresh: tenta na montagem (silent login via cookie)
  const refreshToken = useCallback(async () => {
    try {
      const data = await authFetch("/api/auth/refresh", { method: "POST" });
      tokenRef.current = data.accessToken;
      setUser(data.user);
      return true;
    } catch {
      tokenRef.current = null;
      setUser(null);
      return false;
    }
  }, [authFetch]);

  // Auto-refresh na montagem
  useEffect(() => {
    refreshToken().finally(() => setLoading(false));
  }, [refreshToken]);

  const login = useCallback(async (email, password) => {
    const data = await authFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    tokenRef.current = data.accessToken;
    setUser(data.user);
    return data.user;
  }, [authFetch]);

  const register = useCallback(async ({ email, password, name, cpf, phone, address }) => {
    const data = await authFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name, cpf, phone, address })
    });
    tokenRef.current = data.accessToken;
    setUser(data.user);
    return data.user;
  }, [authFetch]);

  const logout = useCallback(async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST" });
    } catch { /* ignora erros no logout */ }
    tokenRef.current = null;
    setUser(null);
  }, [authFetch]);

  const getToken = useCallback(() => tokenRef.current, []);

  return { user, loading, login, register, logout, refreshToken, getToken };
}
