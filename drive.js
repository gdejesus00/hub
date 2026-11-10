// Google sign-in and reading the content Doc. Read-only Drive scope, and the app only ever
// asks for the one content file. Uses the Google Identity Services token client, which needs
// only the site's origin to be allowed on the Client ID.
import { CONTENT_FILE, GOOGLE_CLIENT_ID } from './config.js';
import * as store from './store.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GSI = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';

const saved = () => store.read('drive', {});
const save = patch => store.write('drive', { ...saved(), ...patch });

let loading;
// Loads Google's sign-in library. Called early so a later tap can open the sign-in window at once.
export function preload() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GSI;
    script.async = true;
    script.onload = resolve;
    script.onerror = () => {
      loading = undefined;
      script.remove();
      reject(new Error("Couldn't reach Google sign-in. Check your connection."));
    };
    document.head.append(script);
  });
  return loading;
}

export const hasToken = () => {
  const { token, expiry } = saved();
  return Boolean(token) && expiry > Date.now() + 60_000;
};
export const account = () => saved().user ?? '';
export const everConnected = () => Boolean(saved().consented);

// Opens Google's sign-in. Must be called from a tap. First time asks for consent, later taps don't.
export async function signIn() {
  await preload();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: response => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description || response.error || 'Sign-in failed.'));
          return;
        }
        save({ token: response.access_token, expiry: Date.now() + Number(response.expires_in || 3600) * 1000, consented: true });
        resolve();
      },
      error_callback: error => {
        const messages = {
          popup_closed: 'Sign-in was closed before it finished.',
          popup_failed_to_open: "The sign-in window couldn't open.",
        };
        reject(new Error(messages[error?.type] || error?.message || 'Sign-in failed.'));
      },
    });
    client.requestAccessToken({ prompt: saved().consented ? '' : 'consent' });
  });
}

async function api(path, asText = false) {
  const response = await fetch(API + path, { headers: { Authorization: `Bearer ${saved().token}` } });
  if (response.status === 401) {
    save({ token: '', expiry: 0 });
    const error = new Error('Sign-in ran out. Tap to sync again.');
    error.code = 'auth';
    throw error;
  }
  if (!response.ok) throw new Error(`Google Drive answered with an error (${response.status}).`);
  return asText ? response.text() : response.json();
}

// Finds the newest content Doc, remembers its id, and returns its body as plain text.
export async function fetchContentText() {
  const query = `name = '${CONTENT_FILE}' and mimeType = 'application/vnd.google-apps.document' and trashed = false`;
  const found = await api(`/files?q=${encodeURIComponent(query)}&orderBy=${encodeURIComponent('modifiedTime desc')}&fields=${encodeURIComponent('files(id,modifiedTime)')}&pageSize=1`);
  const file = found.files?.[0];
  if (!file) throw new Error(`No Google Doc named ${CONTENT_FILE} was found in this Drive.`);
  save({ fileId: file.id });
  const body = await api(`/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent('text/plain')}`, true);
  if (!saved().user) {
    try {
      const about = await api(`/about?fields=${encodeURIComponent('user(emailAddress)')}`);
      if (about.user?.emailAddress) save({ user: about.user.emailAddress });
    } catch {
      // The account name is a nicety. Syncing worked, so carry on.
    }
  }
  return body;
}

// Forgets the sign-in on this phone and asks Google to revoke it.
export function disconnect() {
  const { token } = saved();
  try {
    if (token) window.google?.accounts?.oauth2?.revoke(token, () => {});
  } catch {
    // Revoking is best effort.
  }
  store.remove('drive');
}
