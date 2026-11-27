export default function ProjectFeedback({ feedback }) {
  if (!feedback) return null
  const { error, success, note, refreshError } = feedback
  return (
    <>
      {error && <div className="alert alert-error project-feedback" role="alert">{error}</div>}
      {success && <div className="alert alert-success project-feedback" role="status">{success}</div>}
      {note && <p className="text-xs text-amber project-feedback">{note}</p>}
      {refreshError && (
        <div className="alert alert-warning project-feedback" role="status">{refreshError}</div>
      )}
    </>
  )
}
