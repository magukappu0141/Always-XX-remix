// Where the shared gallery API lives.
// Same origin by default, so nginx can proxy /api to the node process.
// Point this at a full URL if the API sits on another host.
export const API_BASE = '/api';

// Turn the gallery off entirely by setting this to false.
export const GALLERY_ENABLED = true;
