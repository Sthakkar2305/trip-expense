"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"

export function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [isInstallable, setIsInstallable] = useState(false)

  useEffect(() => {
    // Listen for the event that tells us the app can be installed
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setIsInstallable(true)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return

    // Show the native browser install prompt
    deferredPrompt.prompt()

    // Wait for the user to accept or dismiss
    const { outcome } = await deferredPrompt.userChoice
    
    if (outcome === 'accepted') {
      console.log('App installed successfully')
    }

    // Clear the prompt
    setDeferredPrompt(null)
    setIsInstallable(false)
  }

  // Only show the button if the app is installable and not yet installed
  if (!isInstallable) return null

  return (
    <Button 
      onClick={handleInstallClick} 
      className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-md rounded-full px-6 animate-in fade-in zoom-in duration-500"
    >
      <Download className="h-4 w-4 mr-2" />
      Install App
    </Button>
  )
}