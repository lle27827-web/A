import { SignIn, SignUp } from "@clerk/react";
import { Link, useSearch } from "wouter";
import { shadcn } from "@clerk/themes";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Only one whitelisted return target is supported: ?next=personal. */
function usePersonalReturn() {
  const personal = new URLSearchParams(useSearch()).get("next") === "personal";
  return {
    personal,
    qs: personal ? "?next=personal" : "",
    redirect: personal ? { forceRedirectUrl: `${basePath}/personal`, signUpForceRedirectUrl: `${basePath}/personal` } : {},
    redirectUp: personal ? { forceRedirectUrl: `${basePath}/personal`, signInForceRedirectUrl: `${basePath}/personal` } : {},
  };
}

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
  const ret = usePersonalReturn();
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page">
      <div className="auth-heading">
        <Link href="/employees" className="link-soft" data-testid="link-auth-continue-guest">← Tiếp tục xem nhân viên không cần đăng nhập</Link>
        <p data-testid="text-sign-in-scope">{ret.personal ? "Đăng nhập để mở sổ chấm công cá nhân của bạn." : "Mọi tài khoản đều dùng được sổ chấm công cá nhân riêng."} Chỉ chủ sở hữu đã xác minh mới chỉnh sửa được dữ liệu cơ sở.</p>
        <p>Chưa có tài khoản? <Link href={`/sign-up${ret.qs}`} className="link-strong" data-testid="link-to-sign-up">Tạo tài khoản</Link></p>
        <p className="muted small">Quên mật khẩu? Nhập email, nhấn Tiếp tục rồi chọn “Forgot password?” để nhận hướng dẫn đặt lại qua email.</p>
      </div>
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up${ret.qs}`}
        {...ret.redirect}
      />
    </main>
  );
}

export function SignUpPage({ available }: { available: boolean }) {
  const ret = usePersonalReturn();
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page">
      <div className="auth-heading">
        <Link href="/employees" className="link-soft" data-testid="link-auth-continue-guest">← Tiếp tục xem nhân viên không cần đăng nhập</Link>
        <p data-testid="text-sign-up-scope">Tạo tài khoản để có sổ chấm công cá nhân riêng tư. Chỉ email chủ sở hữu đã xác minh mới có quyền chỉnh sửa dữ liệu cơ sở.</p>
        <p>Đã có tài khoản? <Link href={`/sign-in${ret.qs}`} className="link-strong" data-testid="link-to-sign-in">Đăng nhập</Link></p>
      </div>
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in${ret.qs}`}
        {...ret.redirectUp}
      />
    </main>
  );
}

export function AuthSetupPage() {
  return (
    <main className="auth-page">
      <section className="panel auth-notice">
        <h1>Đăng nhập chưa được cấu hình</h1>
        <p>Ứng dụng đang ở chế độ chỉ xem. Cần cấu hình Clerk bên ngoài trong Replit và Vercel trước khi tài khoản có thể đăng nhập (sổ cá nhân) và chủ sở hữu chỉnh sửa dữ liệu cơ sở.</p>
        <p className="muted small">Thiết lập các biến APP_CLERK_SECRET_KEY, APP_CLERK_PUBLISHABLE_KEY, VITE_APP_CLERK_PUBLISHABLE_KEY và ADMIN_EMAIL.</p>
        <Link href="/employees" className="btn primary">Tiếp tục xem nhân viên</Link>
      </section>
    </main>
  );
}

export function AuthLoadingPage() {
  return (
    <main className="auth-page">
      <section className="panel auth-notice" role="status" data-testid="status-restoring-session">Đang khôi phục phiên và kiểm tra quyền truy cập…</section>
    </main>
  );
}

export function AuthRestoreErrorPage({ pending, onRetry, onSignIn }: {
  pending: boolean;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  return (
    <main className="auth-page">
      <section className="panel auth-notice" role="alert" data-testid="status-session-error">
        <h1>Chưa thể xác minh phiên đăng nhập</h1>
        <p>Không cần tải lại trang. Hãy thử kết nối lại; nếu phiên đã hết hạn, hãy đăng nhập lại.</p>
        <button type="button" className="btn primary" onClick={onRetry} disabled={pending}>
          {pending ? 'Đang xác minh…' : 'Thử lại'}
        </button>
        <button type="button" className="btn ghost" onClick={onSignIn} disabled={pending}>Đăng nhập lại</button>
      </section>
    </main>
  );
}
