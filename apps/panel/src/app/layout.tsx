import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { TooltipProvider } from "@/components/ui/tooltip"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
})

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "Hosting Platform",
    template: "%s · Hosting Platform",
  },
  description: "Gestionnaire d'infrastructure et d'hébergement",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetBrainsMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  )
}
