import type { MetadataRoute } from "next";

/**
 * robots.txt — the analytics dashboard and API endpoints are not content
 * for search engines (the admin route can expose wallet addresses), so they
 * are explicitly disallowed while the homepage stays indexable.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/", "/api"],
      },
    ],
  };
}
