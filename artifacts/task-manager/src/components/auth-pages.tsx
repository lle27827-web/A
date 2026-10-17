import { SignIn, SignUp } from "@clerk/react";
import { useSignIn } from "@clerk/react/legacy";
import { useState } from "react";
import { Link, useSearch } from "wouter";
import { shadcn } from "@clerk/themes";
import { BookHeart, Hand, LogIn, LogOut, UserPlus } from "lucide-react";
import { FcGoogle } from "react-icons/fc";

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

function GoogleAccountChooserButton({ personal }: { personal: boolean }) {
  const { isLoaded, signIn } = useSignIn();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseGoogleAccount = async () => {
    if (!isLoaded || !signIn || pending) return;

    setPending(true);
    setError(null);
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${basePath}/sign-in/sso-callback`,
        redirectUrlComplete: personal ? `${basePath}/personal` : basePath || "/",
        oidcPrompt: "select_account",
      });
    } catch {
      setError("Không thể mở danh sách tài khoản Google. Hãy thử lại hoặc đăng nhập bằng email.");
      setPending(false);
    }
  };

  return (
    <div className="auth-google-option">
      <button
        type="button"
        className="auth-google-button"
        onClick={() => void chooseGoogleAccount()}
        disabled={!isLoaded || pending}
        aria-busy={pending}
      >
        <FcGoogle size={20} aria-hidden="true" />
        <span>{pending ? "Đang mở tài khoản Google…" : "Đăng nhập bằng Google"}</span>
      </button>
      {error && <p className="auth-google-error" role="alert">{error}</p>}
    </div>
  );
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

export const WELCOME_TITLE = "Chào mừng bạn đến với Sổ Công";

function WelcomeHeading({ level = 1 }: { level?: 1 | 2 }) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="welcome">
      <span className="brand-mark"><Hand size={22} strokeWidth={2.4} aria-hidden="true" /></span>
      <Heading data-testid="text-welcome-title">{WELCOME_TITLE}</Heading>
      <p data-testid="text-welcome-subtitle">Hãy đăng nhập để sử dụng dịch vụ</p>
    </div>
  );
}

export function WelcomePage() {
  return (
    <main className="auth-page" data-testid="page-welcome">
      <WelcomeHeading />
      <div className="welcome-actions">
        <Link href="/sign-in" className="btn primary" data-testid="link-welcome-sign-in"><LogIn size={15} aria-hidden="true" />Đăng nhập</Link>
        <Link href="/sign-up" className="btn" data-testid="link-welcome-sign-up"><UserPlus size={15} aria-hidden="true" />Đăng ký</Link>
      </div>
    </main>
  );
}

export function SignInPage({ available }: { available: boolean }) {
  const ret = usePersonalReturn();
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page">
      <WelcomeHeading />
      <div className="auth-sign-in-methods">
        <GoogleAccountChooserButton personal={ret.personal} />
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up${ret.qs}`}
          appearance={{
            elements: {
              socialButtonsBlockButton__google: { display: "none" },
            },
          }}
          {...ret.redirect}
        />
      </div>
      <p className="muted small">Chưa có tài khoản? <Link href={`/sign-up${ret.qs}`} className="link-strong" data-testid="link-to-sign-up">Đăng ký</Link></p>
    </main>
  );
}

export function SignUpPage({ available }: { available: boolean }) {
  const ret = usePersonalReturn();
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in${ret.qs}`}
        {...ret.redirectUp}
      />
      <p className="muted small">Đã có tài khoản? <Link href={`/sign-in${ret.qs}`} className="link-strong" data-testid="link-to-sign-in">Đăng nhập</Link></p>
    </main>
  );
}

export function AuthSetupPage() {
  return (
    <main className="auth-page">
      <section className="panel auth-notice">
        <h1>Đăng nhập chưa được cấu hình</h1>
        <p>Cần cấu hình Clerk trước khi tài khoản có thể đăng nhập.</p>
        <p className="muted small">Thiết lập các biến APP_CLERK_SECRET_KEY, APP_CLERK_PUBLISHABLE_KEY, VITE_APP_CLERK_PUBLISHABLE_KEY và ADMIN_EMAIL.</p>
        <Link href="/" className="btn primary">Trang chào mừng</Link>
      </section>
    </main>
  );
}

export function NoFacilityAccessPage({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <main className="auth-page" data-testid="page-no-facility-access">
      <section className="panel no-access">
        <h1>Chưa có quyền truy cập cơ sở</h1>
        <p>Tài khoản của bạn chưa được chủ sở hữu cấp quyền xem dữ liệu cơ sở. Bạn vẫn dùng được sổ chấm công cá nhân.</p>
        <div className="welcome-actions">
          <Link href="/personal" className="btn primary" data-testid="link-no-access-personal"><BookHeart size={15} aria-hidden="true" />Chấm công cá nhân</Link>
          <button type="button" className="btn ghost" onClick={onSignOut} data-testid="button-no-access-sign-out"><LogOut size={15} aria-hidden="true" />Đăng xuất</button>
        </div>
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
