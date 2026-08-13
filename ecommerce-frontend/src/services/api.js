import axios from 'axios'

// One axios instance for the whole app. Import this everywhere instead of
// calling axios directly, so the base URL and the token live in one place.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach the JWT to every call automatically.
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Response interceptor: unwrap the API's { message } into a plain Error, and
// sign the user out if the token has expired.
api.interceptors.response.use(
  response => response,
  error => {
    const status = error.response?.status
    const message =
      error.response?.data?.message ||
      (error.code === 'ERR_NETWORK'
        ? 'Cannot reach the API. Is the backend running on port 5000?'
        : error.message)

    if (status === 401 && localStorage.getItem('token')) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // Full reload so every context resets to a signed-out state.
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?expired=1'
      }
    }

    return Promise.reject(Object.assign(new Error(message), { status }))
  },
)

export default api
