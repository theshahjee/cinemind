export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-rose/40 bg-rose/10 p-4 text-sm text-paper/90">
      {message}
    </div>
  );
}
