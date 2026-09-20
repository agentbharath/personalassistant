"use client";

import { useEffect, useState, useTransition } from "react";
import { clearHomeLocation, saveHomeLocation } from "@/app/settings/actions";
import { Button } from "@/components/ui/Button";
import { LocateIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import styles from "./LocationField.module.css";

/** The saved home location: where Daylark starts from for drive times and what area it searches around. */
export function LocationField({ initial }: { initial: string }) {
  const { toast } = useToast();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState("");
  const [canLocate, setCanLocate] = useState(false);

  // Only offered where the browser can provide a location at all.
  useEffect(() => { setCanLocate("geolocation" in navigator); }, []);

  /**
   * Reads the device location once, turns it into a city, and puts it in the box for the user to check and save. The browser asks for
   * permission at this moment, when the reason is obvious. Nothing is stored until Save is pressed, and the coordinates are never kept.
   */
  function useCurrentLocation() {
    setLocating(true);
    setNote("");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const response = await fetch("/api/location/reverse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude }) });
          const body = await response.json().catch(() => ({})) as { place?: string; error?: string };
          if (response.ok && body.place) { setValue(body.place); setNote(`Found ${body.place}. Check it, then press Save.`); }
          else if (body.error === "GEOCODING_UNAVAILABLE") setNote("City lookup isn’t available right now. Type your city or ZIP instead.");
          else if (body.error === "NO_PLACE_FOUND") setNote("I couldn’t work out a city from that. Type your city or ZIP instead.");
          else setNote("Couldn’t look that up. Type your city or ZIP instead.");
        } catch { setNote("Couldn’t look that up. Type your city or ZIP instead."); }
        setLocating(false);
      },
      (failure) => {
        setNote(failure.code === failure.PERMISSION_DENIED ? "Location access is blocked for this site. You can allow it in your browser’s site settings, or type your city or ZIP." : "Couldn’t get your location. Type your city or ZIP instead.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  }
  const changed = value.trim() !== saved;

  function save() {
    start(async () => {
      try { await saveHomeLocation(value); setSaved(value.replace(/\s+/g, " ").trim()); setValue(value.replace(/\s+/g, " ").trim()); toast({ message: "Home location saved." }); }
      catch { toast({ message: "Couldn’t save that. Enter a city or ZIP code.", tone: "notice" }); }
    });
  }
  function remove() {
    start(async () => {
      try { await clearHomeLocation(); setSaved(""); setValue(""); toast({ message: "Home location removed." }); }
      catch { toast({ message: "Couldn’t remove it. Try again.", tone: "notice" }); }
    });
  }

  return <form className={styles.form} onSubmit={(event) => { event.preventDefault(); if (changed && value.trim()) save(); }}>
    <label className={styles.label} htmlFor="home-location">Home city or ZIP code</label>
    <div className={styles.row}>
      <input id="home-location" className={styles.input} value={value} maxLength={100} placeholder="For example, Oakland, CA or 94612" autoComplete="postal-code" onChange={(event) => setValue(event.target.value)} />
      <Button type="submit" variant="primary" disabled={pending || !changed || !value.trim()}>{pending ? "Saving…" : "Save"}</Button>
      {saved && <Button variant="secondary" disabled={pending} onClick={remove}>Remove</Button>}
    </div>
    {canLocate && <div className={styles.locate}><Button variant="secondary" size="sm" disabled={locating || pending} onClick={useCurrentLocation}><LocateIcon width={15} height={15} />{locating ? "Finding you…" : "Use my current location"}</Button></div>}
    <p className={styles.note} role="status">{note}</p>
  </form>;
}
