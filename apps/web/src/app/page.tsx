export default function Home() {
  return (
    <main style={{ padding: 32, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ marginTop: 0 }}>Submittal Builder</h1>
      <p>
        Phase 1 scaffold. Frontend lands in Step 9; this page exists so{' '}
        <code>pnpm dev</code> renders something at <code>http://localhost:3000</code>.
      </p>
      <ul style={{ lineHeight: 1.8 }}>
        <li>
          <code>POST /api/v1/auth/signup</code> &mdash; create workspace + user
        </li>
        <li>
          <code>POST /api/v1/auth/sign-in/email</code> &mdash; better-auth login
        </li>
        <li>
          <code>POST /api/v1/auth/sign-out</code> &mdash; better-auth logout
        </li>
        <li>
          <code>GET /api/v1/me</code> &mdash; current user + workspace
        </li>
        <li>
          <code>GET /api/v1/healthz</code> &mdash; liveness
        </li>
      </ul>
    </main>
  );
}
