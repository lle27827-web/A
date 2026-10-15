import { SignIn } from "@clerk/react";
import { Link } from "wouter";
import { shadcn } from "@clerk/themes";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  elements: {
    footerAction: { display: "none" },
  },
  variables: {
    colorPrimary: "#f6c84f",
    colorForeground: "#fbf8ef",
    colorMutedForeground: "#b6b8bf",
    colorDanger: "#ff8b83",
    colorBackground: "#111215",
    colorInput: "#191b20",
    colorInputForeground: "#fbf8ef",
    colorNeutral: "#393c44",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.8rem",
  },
};

export function SignInPage({ available }: { available: boolean }) {
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page">
      <div className="auth-heading">
        <Link href="/employees" className="link-soft">← Tiếp tục xem nhân viên không cần đăng nhập</Link>
        <p>Đăng nhập chỉ dành cho chủ sở hữu.</p>
      </div>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </main>
  );
}

export function SignUpDisabledPage() {
  return (
    <main className="auth-page">
      <section className="panel auth-notice">
        <h1>Tài khoản khách không cần đăng nhập</h1>
        <p>Chỉ chủ sở hữu được cấp tài khoản Clerk mới có thể đăng nhập. Khách có thể xem phần quản lý nhân viên mà không cần tài khoản.</p>
        <Link href="/employees" className="btn primary">Tiếp tục xem nhân viên</Link>
      </section>
    </main>
  );
}

export function AuthSetupPage() {
  return (
    <main className="auth-page">
      <section className="panel auth-notice">
        <h1>Đăng nhập chủ sở hữu chưa được cấu hình</h1>
        <p>Ứng dụng đang ở chế độ chỉ xem. Cần cấu hình Clerk bên ngoài trong Replit và Vercel trước khi chủ sở hữu có thể đăng nhập và chỉnh sửa.</p>
        <p className="muted small">Thiết lập các biến APP_CLERK_SECRET_KEY, APP_CLERK_PUBLISHABLE_KEY, VITE_APP_CLERK_PUBLISHABLE_KEY và ADMIN_EMAIL.</p>
        <Link href="/employees" className="btn primary">Tiếp tục xem nhân viên</Link>
      </section>
    </main>
  );
}

export function AuthLoadingPage() {
  return (
    <main className="auth-page">
      <section className="panel auth-notice" role="status">Đang kiểm tra quyền truy cập…</section>
    </main>
  );
}
