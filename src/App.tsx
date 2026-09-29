import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function App() {
  const [dark, setDark] = useState(false)

  return (
    <div className={dark ? 'dark' : undefined}>
      <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Badge variant="secondary" className="mb-3">Project foundation</Badge>
            <CardTitle><h1 className="text-2xl tracking-tight">LABOR Playground</h1></CardTitle>
            <CardDescription>A local circuit workbench, ready to take shape.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Vite, React, TypeScript, and shadcn/ui are set up. The breadboard,
              simulation, and instruments are the next steps.
            </p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" aria-pressed={dark} onClick={() => setDark(!dark)}>
              Dark mode
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  )
}
