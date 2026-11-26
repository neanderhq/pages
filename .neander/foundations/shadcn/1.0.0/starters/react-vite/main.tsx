import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { createRoot } from "react-dom/client";
import "./globals.css";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
createRoot(document.getElementById("root")!).render(<main className="mx-auto max-w-2xl p-6 pt-24"><Card><CardHeader><CardTitle>Your app is ready</CardTitle><CardDescription>Tell Neander what you want to make.</CardDescription></CardHeader></Card></main>);
