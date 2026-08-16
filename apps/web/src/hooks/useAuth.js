import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "";

/**
 * Hook de autenticação.
 *
 * Estado:  { user, loading }
 * Ações:   login(email, pw), register({...}), logout(), refreshToken(), request(path, opts),
 *          updateProfile(patch), changePassword(current, next), forgotPassword(email), resetPassword(token, pw)
 *
 * O accessToken fica em memória (não em localStorage).
 * O refresh token fica em cookie httpOnly (gerenciado pelo backend).
 * Refresh automático: na montagem tenta POST /api/auth/refresh (cookie já presente) e, em
 * qualquer chamada `request()` que receba 401, tenta renovar uma vez e repete.
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(null);
  const refreshingRef = useRef(null);

  // Helper: fetch autenticado (sem retry)
  const authFetch = useCallback(async (path, opts = {}) => {
    const headers = { Accept: "application/json", ...opts.headers };
    if (opts.body && !(opts.body instanceof FormData)) headers["Content-Type"] = "application/json";
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
      err.details = body?.details;
      throw err;
    }
    return body;
  }, []);

  // Refresh: tenta na montagem (silent login via cookie). Single-flight.
  const refreshToken = useCallback(async () => {
    if (refreshingRef.current) return refreshingRef.current;
    refreshingRef.current = (async () => {
      try {
        const data = await authFetch("/api/auth/refresh", { method: "POST" });
        tokenRef.current = data.accessToken;
        setUser(data.user);
        return true;
      } catch {
        tokenRef.current = null;
        setUser(null);
        return false;
      } finally {
        refreshingRef.current = null;
      }
    })();
    return refreshingRef.current;
  }, [authFetch]);

  // Auto-refresh na montagem
  useEffect(() => {
    refreshToken().finally(() => setLoading(false));
  }, [refreshToken]);

  /**
   * Chamada autenticada com renovação automática: se a api responder 401 (access token de 15 min
   * expirou), renova pelo cookie e repete UMA vez. Se ainda falhar, propaga o erro (usuário deslogou).
   */
  const request = useCallback(async (path, opts = {}) => {
    try {
      return await authFetch(path, opts);
    } catch (err) {
      if (err.status !== 401 || opts._retried) throw err;
      const ok = await refreshToken();
      if (!ok) throw err;
      return authFetch(path, { ...opts, _retried: true });
    }
  }, [authFetch, refreshToken]);

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

  const updateProfile = useCallback(async (patch) => {
    const data = await request("/api/auth/me", { method: "PATCH", body: JSON.stringify(patch) });
    setUser(data.user);
    return data.user;
  }, [request]);

  const changePassword = useCallback(
    (currentPassword, newPassword) =>
      request("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
    [request]
  );

  const forgotPassword = useCallback(
    (email) => authFetch("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
    [authFetch]
  );

  const resetPassword = useCallback(
    (token, password) => authFetch("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
    [authFetch]
  );

  const getToken = useCallback(() => tokenRef.current, []);

  return {
    user,
    loading,
    isAdmin: user?.role === "admin",
    login,
    register,
    logout,
    refreshToken,
    request,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
    getToken
  };
}
