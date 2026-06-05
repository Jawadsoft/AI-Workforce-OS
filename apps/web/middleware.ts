import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/login', '/register', '/forgot-password', '/onboarding']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Super admin has its own auth — skip tenant middleware entirely
  if (pathname.startsWith('/super-admin')) {
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
