import { SignIn, SignUp, useSignIn as useClerkSignIn } from "@clerk/react";
import { useSignIn } from "@clerk/react/legacy";
import { useEffect, useRef, useState, type FormEvent, type Ref } from "react";
import { Link, useSearch } from "wouter";
import { shadcn } from "@clerk/themes";
import { viVN } from "@clerk/localizations";
import { BookHeart, Hand, LogIn, LogOut, UserPlus } from "lucide-react";
import { FcGoogle } from "react-icons/fc";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function getPasswordResetErrorMessage(
  error: unknown,
  fallback = "Không thể đặt mật khẩu mới. Hãy thử mật khẩu khác.",
): string {
  if (!error || typeof error !== "object") return fallback;

  const root = error as {
    code?: unknown;
    longMessage?: unknown;
    message?: unknown;
    errors?: unknown;
  };
  const nestedErrors = Array.isArray(root.errors) ? root.errors : [];
  for (const item of [...nestedErrors, root]) {
    if (!item || typeof item !== "object") continue;
    const clerkError = item as { code?: unknown; longMessage?: unknown; message?: unknown };
    if (typeof clerkError.code === "string") {
      const localizedMessages = viVN.unstable__errors as unknown as Record<string, unknown>;
      const localized = localizedMessages[clerkError.code];
      if (typeof localized === "string" && localized.trim()) return localized;
    }
    if (typeof clerkError.longMessage === "string" && clerkError.longMessage.trim()) {
      return clerkError.longMessage;
    }
    if (typeof clerkError.message === "string" && clerkError.message.trim()) {
      return clerkError.message;
    }
  }
  return fallback;
}

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
    <div className="auth-google-option" aria-busy={pending}>
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
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {pending ? "Đang mở danh sách tài khoản Google." : ""}
      </span>
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
const WELCOME_BRAND = "Sổ Công";

function WelcomeHeading({ level = 1, headingId = "welcome-title", headingRef }: {
  level?: 1 | 2;
  headingId?: string;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <div className="welcome">
      <span className="brand-mark"><Hand size={22} strokeWidth={2.4} aria-hidden="true" /></span>
      <Heading id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined} data-testid="text-welcome-title">
        Chào mừng bạn đến với <span className="welcome-brand">{WELCOME_BRAND}</span>
      </Heading>
      <p id="welcome-instructions" data-testid="text-welcome-subtitle">Hãy đăng nhập để sử dụng dịch vụ</p>
    </div>
  );
}

export function WelcomePage() {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="auth-page" aria-labelledby="welcome-title" data-testid="page-welcome">
      <WelcomeHeading headingId="welcome-title" headingRef={headingRef} />
      <div className="welcome-actions">
        <Link href="/sign-in" className="btn primary" data-testid="link-welcome-sign-in"><LogIn size={15} aria-hidden="true" />Đăng nhập</Link>
        <Link href="/sign-up" className="btn" data-testid="link-welcome-sign-up"><UserPlus size={15} aria-hidden="true" />Đăng ký</Link>
      </div>
    </main>
  );
}

export function SignInPage({ available }: { available: boolean }) {
  const ret = usePersonalReturn();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page" aria-labelledby="sign-in-title" aria-describedby="welcome-instructions">
      <WelcomeHeading headingId="sign-in-title" headingRef={headingRef} />
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
      <p id="sign-in-instructions" className="muted small">
        <a href={`${basePath}/sign-in/forgot-password${ret.qs}`} className="link-strong" data-testid="link-forgot-password">Quên mật khẩu?</a>
      </p>
      <p className="muted small">Chưa có tài khoản? <Link href={`/sign-up${ret.qs}`} className="link-strong" data-testid="link-to-sign-up">Đăng ký</Link></p>
    </main>
  );
}

export function ForgotPasswordPage({ available }: { available: boolean }) {
  if (!available) return <AuthSetupPage />;
  return <ForgotPasswordFlow />;
}

function ForgotPasswordFlow() {
  const ret = usePersonalReturn();
  const { signIn, fetchStatus } = useClerkSignIn();
  const [step, setStep] = useState<"email" | "code" | "password" | "complete">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = fetchStatus === "fetching";
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step, headingRef]);

  const stepTitle = {
    email: "Khôi phục mật khẩu",
    code: "Nhập mã xác minh",
    password: "Tạo mật khẩu mới",
    complete: "Đã đổi mật khẩu",
  }[step];
  const pendingMessage = step === "email" ? "Đang gửi mã khôi phục."
    : step === "code" ? "Đang xác minh mã."
      : step === "password" ? "Đang cập nhật mật khẩu."
        : "";

  const sendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setNotice(null);
    try {
      await signIn.reset();
      const created = await signIn.create({ identifier: email.trim() });
      if (created.error) {
        setError("Không thể bắt đầu khôi phục. Hãy kiểm tra email và thử lại.");
        return;
      }
      const sent = await signIn.resetPasswordEmailCode.sendCode();
      if (sent.error) {
        setError("Không gửi được mã khôi phục. Hãy kiểm tra email hoặc thử lại sau.");
        return;
      }
      setStep("code");
      setNotice("Nếu email thuộc tài khoản đã đăng ký, mã khôi phục sẽ được gửi đến email đó.");
    } catch {
      setError("Không thể gửi mã khôi phục lúc này. Hãy thử lại sau.");
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setNotice(null);
    try {
      const result = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (result.error) {
        setError("Mã xác minh không đúng hoặc đã hết hạn. Hãy kiểm tra lại mã.");
        return;
      }
      setStep("password");
    } catch {
      setError("Không xác minh được mã. Hãy thử lại.");
    }
  };

  const resendCode = async () => {
    if (pending) return;
    setError(null);
    setNotice(null);
    try {
      const result = await signIn.resetPasswordEmailCode.sendCode();
      if (result.error) {
        setError(getPasswordResetErrorMessage(result.error, "Không gửi lại được mã. Hãy thử lại sau."));
        return;
      }
      setNotice("Nếu email thuộc tài khoản đã đăng ký, mã khôi phục mới sẽ được gửi đến email đó.");
    } catch (caughtError) {
      setError(getPasswordResetErrorMessage(caughtError, "Không gửi lại được mã. Hãy thử lại sau."));
    }
  };

  const submitNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận chưa khớp.");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const result = await signIn.resetPasswordEmailCode.submitPassword({ password });
      if (result.error) {
        setError(getPasswordResetErrorMessage(result.error));
        return;
      }

      if (signIn.status === "complete") {
        const finalized = await signIn.finalize({
          navigate: async ({ session, decorateUrl }) => {
            if (session?.currentTask) {
              setStep("complete");
              setNotice("Mật khẩu đã đổi. Hãy hoàn tất bước xác thực bổ sung khi đăng nhập.");
              return;
            }
            const destination = ret.personal ? `${basePath}/personal` : `${basePath}/`;
            window.location.assign(decorateUrl(destination));
          },
        });
        if (finalized.error) {
          setStep("complete");
          setNotice("Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.");
        }
        return;
      }

      setStep("complete");
      setNotice(
        signIn.status === "needs_second_factor"
          ? "Mật khẩu đã đổi. Tài khoản cần xác thực bổ sung; hãy đăng nhập để hoàn tất."
          : "Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.",
      );
    } catch (caughtError) {
      setError(getPasswordResetErrorMessage(caughtError));
    }
  };

  const changeEmail = async () => {
    if (pending) return;
    try {
      await signIn.reset();
      setCode("");
      setError(null);
      setNotice(null);
      setStep("email");
    } catch (caughtError) {
      setError(getPasswordResetErrorMessage(caughtError, "Không thể đổi email lúc này. Hãy thử lại."));
    }
  };

  return (
    <main className="auth-page" aria-labelledby="recovery-title" data-testid="page-forgot-password">
      <WelcomeHeading level={2} headingId="recovery-welcome-title" />
      <section className="panel auth-notice auth-reset-panel" aria-labelledby="recovery-title">
        <h1 id="recovery-title" ref={headingRef} tabIndex={-1}>{stepTitle}</h1>
        {step === "email" && (
          <form className="auth-reset-form" onSubmit={(event) => void sendCode(event)} aria-busy={pending}>
            <p>Nhập email đã đăng ký để nhận mã khôi phục.</p>
            <label className="field" htmlFor="recovery-email">
              Email
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Nhập địa chỉ email"
                aria-describedby={error ? "recovery-error" : undefined}
                data-testid="input-recovery-email"
              />
            </label>
            <button type="submit" className="btn primary" disabled={pending} data-testid="button-send-recovery-code">
              {pending ? "Đang gửi…" : "Gửi mã khôi phục"}
            </button>
          </form>
        )}
        {step === "code" && (
          <form className="auth-reset-form" onSubmit={(event) => void verifyCode(event)} aria-busy={pending}>
            <p>Nhập mã xác minh được gửi đến email của bạn.</p>
            <label className="field" htmlFor="recovery-code">
              Mã xác minh
              <input
                id="recovery-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-describedby={error ? "recovery-error" : undefined}
                data-testid="input-recovery-code"
              />
            </label>
            <button type="submit" className="btn primary" disabled={pending} data-testid="button-verify-recovery-code">
              {pending ? "Đang xác minh…" : "Xác minh mã"}
            </button>
            <button type="button" className="btn ghost" onClick={() => void changeEmail()} disabled={pending}>
              Dùng email khác
            </button>
            <button type="button" className="btn ghost" onClick={() => void resendCode()} disabled={pending}>
              Gửi lại mã
            </button>
          </form>
        )}
        {step === "password" && (
          <form className="auth-reset-form" onSubmit={(event) => void submitNewPassword(event)} aria-busy={pending}>
            <p>Tạo mật khẩu mới cho tài khoản.</p>
            <label className="field" htmlFor="recovery-new-password">
              Mật khẩu mới
              <input
                id="recovery-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-describedby={`recovery-password-hint${error ? " recovery-error" : ""}`}
                data-testid="input-new-password"
              />
            </label>
            <label className="field" htmlFor="recovery-confirm-password">
              Nhập lại mật khẩu mới
              <input
                id="recovery-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                aria-describedby={error ? "recovery-error" : undefined}
                data-testid="input-confirm-new-password"
              />
            </label>
            <span id="recovery-password-hint" className="sr-only">Mật khẩu phải có ít nhất 8 ký tự.</span>
            <button type="submit" className="btn primary" disabled={pending} data-testid="button-save-new-password">
              {pending ? "Đang cập nhật…" : "Đặt mật khẩu mới"}
            </button>
          </form>
        )}
        {step === "complete" && (
          <>
            <p>Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới.</p>
            <Link href={`/sign-in${ret.qs}`} className="btn primary" data-testid="link-recovery-sign-in">Đăng nhập</Link>
          </>
        )}
        {pending && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{pendingMessage}</p>}
        {notice && <p className="auth-reset-notice" role="status" aria-live="polite">{notice}</p>}
        {error && <p id="recovery-error" className="auth-reset-error" role="alert">{error}</p>}
        {step !== "complete" && (
          <Link href={`/sign-in${ret.qs}`} className="link-strong" data-testid="link-back-to-sign-in">Quay lại đăng nhập</Link>
        )}
      </section>
    </main>
  );
}

export function SignUpPage({ available }: { available: boolean }) {
  const ret = usePersonalReturn();
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  if (!available) return <AuthSetupPage />;

  return (
    <main className="auth-page" aria-label="Đăng ký tài khoản">
      <h1 className="sr-only" ref={headingRef} tabIndex={-1}>Đăng ký tài khoản</h1>
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
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="auth-page" aria-labelledby="auth-setup-title">
      <section className="panel auth-notice">
        <h1 id="auth-setup-title" ref={headingRef} tabIndex={-1}>Đăng nhập chưa được cấu hình</h1>
        <p>Cần cấu hình Clerk trước khi tài khoản có thể đăng nhập.</p>
        <p className="muted small">Thiết lập các biến APP_CLERK_SECRET_KEY, APP_CLERK_PUBLISHABLE_KEY, VITE_APP_CLERK_PUBLISHABLE_KEY và ADMIN_EMAIL.</p>
        <Link href="/" className="btn primary">Trang chào mừng</Link>
      </section>
    </main>
  );
}

export function NoFacilityAccessPage({ onSignOut }: { onSignOut?: () => void }) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="auth-page" aria-labelledby="no-facility-title" data-testid="page-no-facility-access">
      <section className="panel no-access">
        <h1 id="no-facility-title" ref={headingRef} tabIndex={-1}>Chưa có quyền truy cập cơ sở</h1>
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
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="auth-page" aria-labelledby="session-loading-title">
      <section className="panel auth-notice" aria-busy="true" data-testid="status-restoring-session">
        <h1 id="session-loading-title" ref={headingRef} tabIndex={-1}>Đang khôi phục phiên</h1>
        <p role="status" aria-live="polite">Đang kiểm tra phiên đăng nhập và quyền truy cập…</p>
      </section>
    </main>
  );
}

export function AuthRestoreErrorPage({ pending, onRetry, onSignIn }: {
  pending: boolean;
  onRetry: () => void;
  onSignIn: () => void;
}) {
  const headingRef = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="auth-page" aria-labelledby="session-error-title">
      <section className="panel auth-notice" role="alert" data-testid="status-session-error">
        <h1 id="session-error-title" ref={headingRef} tabIndex={-1}>Chưa thể xác minh phiên đăng nhập</h1>
        <p>Không cần tải lại trang. Hãy thử kết nối lại; nếu phiên đã hết hạn, hãy đăng nhập lại.</p>
        <button type="button" className="btn primary" onClick={onRetry} disabled={pending}>
          {pending ? 'Đang xác minh…' : 'Thử lại'}
        </button>
        <button type="button" className="btn ghost" onClick={onSignIn} disabled={pending}>Đăng nhập lại</button>
      </section>
    </main>
  );
}
