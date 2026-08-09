# DAYMARK

### Daylight Analysis & Year-round Mapping of Astronomical Rotational Kinematics

[![DAYMARK Pages Deployment](https://github.com/SgtEpsilon/DAYMARK/actions/workflows/pages.yml/badge.svg)](https://github.com/SgtEpsilon/DAYMARK/actions/workflows/pages.yml)

**DAYMARK** is a browser-based planetary daylight analysis and navigation tool designed to determine the best latitude and longitude locations for daylight on planetary bodies.

The application analyses a planet's rotation, orbit, axial tilt and eccentricity over an entire orbital period to identify locations with favourable solar conditions.

---

## 🌐 Live Website

**[Open DAYMARK](https://sgtepsilon.github.io/DAYMARK/)**

---

## 🚀 GitHub Pages

DAYMARK is a static client-side website and does not require a backend or database.

The site is automatically deployed to GitHub Pages whenever changes are pushed to the `main` branch.

```text
main
  │
  ▼
GitHub Actions
  │
  ├── Checkout
  ├── Configure GitHub Pages
  ├── Upload site artifact
  └── Deploy Pages
  │
  ▼
DAYMARK
```

---

## ✦ Features

### Planetary Analysis

DAYMARK accepts:

- Orbital period
- Rotational period
- Axial tilt
- Orbital eccentricity
- Argument of periapsis

These parameters are used to model the planet's solar illumination throughout its orbital period.

### Surface Location Optimisation

DAYMARK searches planetary latitude and longitude coordinates to identify locations with favourable daylight conditions.

The analysis currently provides:

- Optimal latitude
- Optimal longitude
- Percentage of time in daylight
- Longest continuous daylight period
- Longest continuous night period
- Average solar altitude
- Minimum solar altitude
- Maximum solar altitude

### Rotation Detection

The application can identify common rotational relationships, including:

- Normal planetary rotation
- Synchronous / 1:1 rotation
- 2:1 spin-orbit resonance
- 1:2 spin-orbit relationship

---

## 🗺️ Daylight Heatmap

DAYMARK includes a planetary daylight heatmap showing the distribution of solar illumination across the planetary surface.

The planned heatmap will provide multiple analysis modes:

- **Daylight %**
- **Average Solar Altitude**
- **Minimum Solar Altitude**
- **Longest Continuous Daylight**

The map will also support selectable latitude and longitude coordinates for detailed surface analysis.

---

## 🧭 Coordinate Optimisation

The primary purpose of DAYMARK is to answer:

> **"Where on this planet should I go if I want the best possible daylight?"**

The optimiser evaluates planetary surface coordinates across the complete orbital period and ranks locations according to their solar conditions.

This is particularly useful for:

- Tidally locked planets
- High axial-tilt planets
- Low-eccentricity planets
- Normal rotating planets
- Long-period planetary bodies
- Finding locations with extended daylight
- Finding locations with favourable solar elevation

---

## ⚙️ How It Works

DAYMARK uses a numerical orbital model to sample the planet throughout its orbital period.

The model considers:

```text
Orbital Period
       │
       ▼
Orbital Position
       │
       ├── Eccentricity
       │
       ├── Argument of Periapsis
       │
       ▼
Solar Position
       │
       ├── Axial Tilt
       ├── Rotation
       └── Surface Coordinates
       │
       ▼
Solar Elevation
       │
       ▼
Daylight Analysis
       │
       ▼
Optimal Coordinates