export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-6">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-muted">{note}</p>
    </section>
  );
}
