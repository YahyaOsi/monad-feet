import { useUser } from "@/context/UserContext";
import { useListSubscriptions, useListPrivatePosts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Lock, Crown, Calendar } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";

export default function PrivateFeed() {
  const { data: subscriptions, isLoading: subsLoading } = useListSubscriptions();

  // For simplicity, we just fetch posts for the first sub if exists. 
  // A complete app might merge them or have a selector.
  const activeSub = subscriptions?.[0];
  
  const { data: privatePosts, isLoading: postsLoading } = useListPrivatePosts(
    { creatorId: activeSub?.creatorId || 0 },
    { query: { enabled: !!activeSub } }
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 text-primary rounded-lg">
          <Lock className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Private Feed</h1>
          <p className="text-muted-foreground">Exclusive content from creators you subscribe to</p>
        </div>
      </div>

      {!subsLoading && (!subscriptions || subscriptions.length === 0) ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Crown className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No Subscriptions Yet</h2>
            <p className="text-muted-foreground max-w-sm mb-6">
              Subscribe to creators to unlock their exclusive private content and insights.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-4">
            {postsLoading ? (
              <div className="space-y-4">
                {[...Array(2)].map((_, i) => (
                  <Card key={i} className="animate-pulse h-40" />
                ))}
              </div>
            ) : privatePosts?.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No private posts from your creators yet.
                </CardContent>
              </Card>
            ) : (
              privatePosts?.map(post => (
                <Card key={post.id} className="border-primary/20 bg-primary/5">
                  <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={post.creatorAvatarUrl || ""} />
                        <AvatarFallback>{post.creatorName?.slice(0,2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-semibold text-sm">{post.creatorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                    <div className="bg-primary text-primary-foreground text-xs px-2 py-1 rounded font-medium flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Subscriber Only
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-2">
                    <p className="whitespace-pre-wrap">{post.content}</p>
                    {post.imageUrl && (
                      <div className="mt-3 rounded-md overflow-hidden bg-muted">
                        <img src={post.imageUrl} alt="Post attachment" className="max-h-96 w-auto object-cover" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Your Subscriptions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {subscriptions?.map(sub => (
                  <div key={sub.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={sub.creatorAvatarUrl || ""} />
                        <AvatarFallback>{sub.creatorName?.slice(0,2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium text-sm">{sub.creatorName}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> Renews {format(new Date(sub.expiresAt), "MMM d")}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
