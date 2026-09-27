import ShowPreview from "@/components/show-preview";
export default async function Page({
  params,
}: {
  params: Promise<{ instance: string; id: string }>;
}) {
  return <ShowPreview {...await params} />;
}
