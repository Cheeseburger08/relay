import sharp from "sharp";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageSquare } from "lucide-react";
import { resolve } from "node:path";
const svg = renderToStaticMarkup(
  React.createElement(MessageSquare, {
    size: 280,
    color: "#ffffff",
    strokeWidth: 1.5,
  }),
);
for (const size of [180, 192, 512]) {
  const icon = await sharp(Buffer.from(svg))
    .resize(Math.round(size * 0.55))
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#157b68" },
  })
    .composite([{ input: icon, gravity: "centre" }])
    .png()
    .toFile(
      resolve(
        "public",
        size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`,
      ),
    );
}
