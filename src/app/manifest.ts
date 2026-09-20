import type { MetadataRoute } from "next";

/** Lets Daylark be installed to a phone's home screen and opened full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Daylark",
    short_name: "Daylark",
    description: "A private assistant for your calendar, email and spending.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#f7f8fa",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
