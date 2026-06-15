# Short URL Workbench

A local website for turning long URLs or safe app links into short links like `http://127.0.0.1:3000/s/my-link`.

## Run

1. Open this folder in a terminal.
2. Run `npm start`.
3. Open `http://127.0.0.1:3000`.

No package install is required because the server uses only Node.js built-in modules.

On the Desktop/UNC copy, you can also run `start-short-url.bat`; it uses `pushd` so Windows can run it from a network share path.

## Features

- Shortens long `http` and `https` URLs.
- Supports safe link types such as `mailto:`, `tel:`, `ftp:`, `magnet:`, and custom app deep links.
- Blocks unsafe protocols such as `javascript:`, `data:`, `vbscript:`, `file:`, and `about:`.
- Optional custom aliases, for example `/s/school-form`.
- Persistent storage in `data/links.json`.
- Real redirects from `/s/<alias>`.
- Click counts and last-opened timestamps.
- Search, copy, open, delete, and JSON export controls.

## Useful Commands

```powershell
npm start
npm run check
```

To use another port:

```powershell
$env:PORT="4174"; npm start
```

## Files

- `server.js` - Node.js server, API, redirect routes, validation, and JSON storage.
- `public/index.html` - Browser UI.
- `public/styles.css` - Responsive styling.
- `public/app.js` - Frontend behavior and API calls.
- `data/links.json` - Saved short links.
