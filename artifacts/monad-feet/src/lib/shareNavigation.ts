const SHARE_RETURN_PATH = /^\/(?:post|profile)\/[1-9]\d*$/;

export function safeShareReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  const path = value.split(/[?#]/, 1)[0];
  return SHARE_RETURN_PATH.test(path) ? path : null;
}

export function onboardingPath(returnTo: string | null | undefined): string {
  const safePath = safeShareReturnPath(returnTo);
  return safePath
    ? `/onboarding?returnTo=${encodeURIComponent(safePath)}`
    : "/onboarding";
}

export function postLoginPath(search: string): string | null {
  const params = new URLSearchParams(search);
  return safeShareReturnPath(params.get("returnTo"));
}