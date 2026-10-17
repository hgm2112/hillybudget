import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "hillybudget",
    short_name: "hillybudget",
    description: "Household expense tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#101214",
    theme_color: "#d85700",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
