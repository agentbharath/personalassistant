import { StatusPage } from "@/components/layout/StatusPage";
import { ButtonLink } from "@/components/ui/Button";

export default function NotFound() {
  return <StatusPage code="404" title="That page doesn’t exist" actions={<>
    <ButtonLink variant="primary" href="/">Go to Daylark</ButtonLink>
    <ButtonLink href={{ pathname: "/history" }}>Your history</ButtonLink>
  </>}>
    The link may be old, or the page may have moved.
  </StatusPage>;
}
