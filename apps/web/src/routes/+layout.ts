// The whole app runs in the browser: the access token lives in its memory and the refresh cookie
// belongs to the API's origin, so the server rendering the pages could not sign anyone in.
export const ssr = false;
