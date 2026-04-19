import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        // 프론트엔드에서 /api/analyze-stream 으로 신호를 보내면
        source: "/api/analyze-stream",
        // 실제 백엔드 주소인 8000번 포트의 /analyze/stream 으로 바로 연결해라!
        destination: "http://127.0.0.1:8000/analyze/stream",
      },
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/:path*",
      },
    ];
  },
};

export default nextConfig;
