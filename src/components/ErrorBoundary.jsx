import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error?.message || 'Đã xảy ra lỗi hiển thị không mong muốn.',
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page-container">
          <div className="card" style={{ padding: 24, maxWidth: 560, margin: '40px auto' }}>
            <h3 style={{ color: '#dc2626', marginBottom: 8 }}>
              ⚠️ Có lỗi xảy ra trên màn hình này
            </h3>
            <p className="text-muted" style={{ marginBottom: 16, fontSize: 14 }}>
              {this.state.message}
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => this.setState({ hasError: false, message: '' })}
              >
                🔄 Thử lại ngay
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => window.location.reload()}
              >
                Tải lại toàn trang
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
