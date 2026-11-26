export function isRuntimeRequestPath(pathname: string) {
  return pathname === "/api" || pathname.startsWith("/api/")
    || pathname === "/public" || pathname.startsWith("/public/");
}
