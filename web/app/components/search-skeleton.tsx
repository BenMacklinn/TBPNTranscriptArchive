export function SearchSkeleton() {
  return (
    <div className="results-grid" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <article className="result-card skeleton-card" key={index}>
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-line title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line medium" />
          <div className="skeleton skeleton-actions">
            <div className="skeleton skeleton-pill" />
            <div className="skeleton skeleton-pill" />
          </div>
        </article>
      ))}
    </div>
  );
}
