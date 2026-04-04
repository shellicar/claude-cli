
export const getBody = (body: RequestInit['body'] | undefined, headers: Record<string, string>) => {
  try {
    if (typeof body === 'string' && headers['content-type'] === 'application/json') {
      return JSON.parse(body);
    }
  }
  catch {
    // ignore
  }
  return body;
};
