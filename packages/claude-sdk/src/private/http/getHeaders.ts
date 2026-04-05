export const getHeaders = (headers: RequestInit['headers'] | undefined): Record<string, string> => {
  if (headers == null) {
    return {};
  }
  return Object.fromEntries(new Headers(headers).entries());
};
