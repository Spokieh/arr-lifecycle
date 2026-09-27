import MoviePreview from "@/components/movie-preview";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MoviePreview id={id} modal />;
}
