import axios from 'axios'

function getApiUrl(): string {
  // If an explicit env var is set, use it
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL
  }
  // In the browser, derive API URL from the current hostname
  // so it works from both localhost AND network IP
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}:3001/api/v1`
  }
  return 'http://localhost:3001/api/v1'
}

export const api = axios.create({
  baseURL: getApiUrl(),
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  }
  // Let the browser set Content-Type automatically for FormData (includes boundary)
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type']
  }
  return config
})

api.interceptors.response.use(
  (response) => {
    if (response.data?.access_token) {
      const token = response.data.access_token
      document.cookie = `access_token=${token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`
    }
    return response
  },
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('access_token')
      document.cookie = 'access_token=; path=/; max-age=0'
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)
