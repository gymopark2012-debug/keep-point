/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
      {
        source: "/reader/:id",
        destination: "/reader.html?id=:id"
      }
    ];
  }
};

export default nextConfig;
