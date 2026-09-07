import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-lg font-semibold">Nie znaleziono</h1>
      <p className="mt-2 text-sm muted">
        Ta sesja nie istnieje albo jej transkrypt został usunięty.
      </p>
      <Link href="/sessions" className="mt-4 inline-block text-sm accent underline">
        ← Wróć do listy sesji
      </Link>
    </div>
  )
}
