import { Link } from 'wouter';

export default function NotFound() {
  return (
    <section className="nf">
      <div style={{ textAlign: 'center', display: 'grid', gap: 12 }}>
        <h1>404</h1>
        <p style={{ margin: 0 }}>Không tìm thấy trang này.</p>
        <Link href="/" className="btn primary" data-testid="link-notfound-home">Về trang chính</Link>
      </div>
    </section>
  );
}
