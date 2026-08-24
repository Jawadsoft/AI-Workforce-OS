import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/reset-password', '/onboarding', '/sso']
const LANDING_ROUTES = ['/']
// SSO must stay reachable even when already logged in (token handoff / test page)
const AUTH_BYPASS_ROUTES = ['/sso']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Super admin and public widget have their own auth — skip tenant middleware
  if (pathname.startsWith('/super-admin') || pathname.startsWith('/widget')) {
    return NextResponse.next()
  }

  // Marketing landing is always public (including signed-in users)
  if (LANDING_ROUTES.includes(pathname)) {
    return NextResponse.next()
  }

  if (AUTH_BYPASS_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  const token = request.cookies.get('access_token')?.value
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route))

  if (!token && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (token && isPublicRoute) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
}
