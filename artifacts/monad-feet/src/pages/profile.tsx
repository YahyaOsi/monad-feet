import { useParams } from "wouter";
import { useUser } from "@/context/UserContext";
import { useGetUser, useListPosts, useListBadges, useGetCreatorSubscriptionPrice, useCreateSubscription } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge as UiBadge } from "@/components/ui/badge";
import { PostCard } from "@/components/post/PostCard";
import { Trophy, Calendar, Flame, Lock } from "lucide-react";
import { format } from "date-fns";

export default function Profile() {
  const params = useParams();
  const userId = Number(params.userId);
  const { user: currentUser } = useUser();
  const isOwnProfile = currentUser?.id === userId;

  const { data: profile, isLoading } = useGetUser(userId, { query: { enabled: !!userId } });
  
  // Custom posts fetch - assuming useListPosts can filter by author, but our generated API schema doesn't have an author filter in ListPostsParams.
  // We'll just fetch all and filter client side for demo, or assume backend doesn't support it and just show user's stats
  const { data: postsPage } = useListPosts({});
  const userPosts = postsPage?.posts.filter(p => p.authorId === userId) || [];

  const { data: badges } = useListBadges({ query: { enabled: isOwnProfile } });
  const { data: subPrice } = useGetCreatorSubscriptionPrice(userId, { query: { enabled: !isOwnProfile && !!userId } });
  
  const createSub = useCreateSubscription();

  const handleSubscribe = async () => {
    if (!subPrice || !currentUser) return;
    try {
      // In reality, a wallet TX would happen here
      await createSub.mutateAsync({
        data: {
          creatorId: userId,
          subscriberWalletAddress: currentUser.walletAddress,
          txHash: "0x_mock_tx_hash"
        }
      });
      alert("Subscribed successfully!");
    } catch (e) {
      console.error(e);
    }
  };

  if (isLoading || !profile) return <div className="py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none shadow-sm bg-card">
        <div className="h-32 bg-gradient-to-r from-primary/20 to-accent/40" />
        <CardContent className="px-6 pb-6 pt-0 relative">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end -mt-12 sm:-mt-16 mb-4">
            <Avatar className="h-24 w-24 sm:h-32 sm:w-32 border-4 border-background bg-background shadow-sm">
              <AvatarImage src={profile.avatarUrl || ""} />
              <AvatarFallback className="text-2xl">{profile.name?.slice(0,2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 pb-2">
              <h1 className="text-2xl font-bold">{profile.name}</h1>
              <p className="text-muted-foreground font-medium">@{profile.username}</p>
            </div>
            {!isOwnProfile && subPrice && subPrice.pricePerMonth > 0 && (
              <div className="pb-2">
                <Button onClick={handleSubscribe} disabled={createSub.isPending} className="gap-2">
                  <Lock className="h-4 w-4" />
                  Subscribe • {subPrice.pricePerMonth} MON/mo
                </Button>
              </div>
            )}
          </div>

          <p className="text-foreground/90 max-w-2xl mb-4">{profile.bio || "No bio provided."}</p>
          
          <div className="flex flex-wrap gap-y-2 gap-x-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">
                {profile.walletAddress.slice(0,6)}...{profile.walletAddress.slice(-4)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" /> Joined {format(new Date(profile.createdAt), "MMMM yyyy")}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1">Posts</p>
            <p className="text-2xl font-bold">{profile.postCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1">Likes Received</p>
            <p className="text-2xl font-bold">{profile.totalLikes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Flame className="h-4 w-4 text-orange-500" /> Streak
            </p>
            <p className="text-2xl font-bold">{profile.currentStreak}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Trophy className="h-4 w-4 text-yellow-500" /> Points
            </p>
            <p className="text-2xl font-bold">{profile.streakPoints}</p>
          </CardContent>
        </Card>
      </div>

      {isOwnProfile && badges && badges.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Badges</h3>
          <div className="flex flex-wrap gap-2">
            {badges.map(b => (
              <UiBadge key={b.id} variant="secondary" className="px-3 py-1.5 text-sm gap-1.5 bg-primary/10 text-primary hover:bg-primary/20">
                <Trophy className="h-3.5 w-3.5" />
                {b.label}
              </UiBadge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4 pt-4">
        <h3 className="font-semibold text-lg border-b pb-2">Posts</h3>
        {userPosts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No posts yet.</div>
        ) : (
          userPosts.map(post => <PostCard key={post.id} post={post} />)
        )}
      </div>
    </div>
  );
}
