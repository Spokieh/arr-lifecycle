import { MovieModal } from "@/components/movie-modal";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <MovieModal>{children}</MovieModal>;
}
