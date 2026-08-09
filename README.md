# Planetary Daylight Optimizer

A static, client-side planetary daylight calculator designed for GitHub Pages.

## Features

- Accepts orbital period, rotational period, axial tilt, eccentricity and argument of periapsis.
- Numerically samples an entire orbit.
- Searches fixed latitude/longitude coordinates.
- Handles ordinary rotation and synchronous rotation using the same model.
- Detects approximate 1:1 and 2:1 spin/orbit relationships.
- Produces daylight percentage, longest continuous day/night and solar-altitude statistics.
- Generates a daylight heatmap.
- Requires no backend, database or API.

## GitHub Pages

1. Create a GitHub repository.
2. Upload `index.html`, `styles.css` and `app.js` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select your main branch and `/ (root)`.
6. Save.

GitHub will publish the site at the repository's Pages URL.

## Important model limitation

The calculator is deliberately self-contained and intended for game use. Exact game astronomy may use a different epoch, longitude convention, orbital reference direction or axial-tilt convention. The next version should allow a game-specific orbital phase/epoch and rotation direction so coordinates can be matched against observed in-game positions.
