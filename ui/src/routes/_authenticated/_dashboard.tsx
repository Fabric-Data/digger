import { redirect, createFileRoute, Outlet, useLocation } from '@tanstack/react-router';
import { useState } from 'react';
import { getSignInUrl } from '../../authkit/serverFunctions';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger } from '@/components/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { GitBranch, Folders, Waves, Settings, CreditCard, LogOut, Cuboid, Bot, X } from 'lucide-react';
import WorkosOrgSwitcher from '@/components/WorkosOrgSwitcher';
import { WorkOsWidgets } from '@workos-inc/widgets';

export const Route = createFileRoute('/_authenticated/_dashboard')({
    component: DashboardComponent,
    loader: async ({ context }) => {
        const { user, organisationName, organisationId, publicServerConfig } = context;
        return { user, organisationName, organisationId, publicServerConfig };
    },
});

function DashboardComponent() {
    const { user, organisationName, organisationId, publicServerConfig } = Route.useLoaderData();
    const workosEnabled = publicServerConfig.WORKOS_REDIRECT_URI !== '';
    const location = useLocation();
    const [isCopilotOpen, setIsCopilotOpen] = useState(false);
    return (
        <SidebarProvider>
        <WorkOsWidgets
          style={{ display: 'contents', minHeight: 'auto', height: 'auto' } as any}
          theme={{ panelBackground: 'solid', radius: 'none' } as any}
        >
        <div className="flex h-screen w-full">
          <Sidebar>
            <SidebarHeader className="text-center">
              <h2 className="text-xl font-bold mb-2">🌮 OpenTACO</h2>
              <div className="px-4">
                <div className="h-[1px] bg-border mb-2" />
                {!workosEnabled && <h3>
                  <Link 
                    to="/dashboard/settings/user" 
                    className="text-sm text-muted-foreground hover:text-primary transition-colors duration-200"
                  >
                    {organisationName}
                  </Link>
                  
                </h3>}
                <div className="mt-2" />
                {workosEnabled && <WorkosOrgSwitcher userId={user?.id || ''} organisationId={organisationId || ''} showSettingsItem />}
                
                <div className="h-[1px] bg-border mt-2" />
              </div>
            </SidebarHeader>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Menu</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>

                  <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.pathname.startsWith('/dashboard/units')}>
                        <Link to="/dashboard/units">
                          <Cuboid className="mr-2 h-4 w-4" />
                          <span>Units</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.pathname.startsWith('/dashboard/repos')}>
                        <Link to="/dashboard/repos">
                          <GitBranch className="mr-2 h-4 w-4" />
                          <span>Repos</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.pathname.startsWith('/dashboard/projects')}>
                        <Link to="/dashboard/projects">
                          <Folders className="mr-2 h-4 w-4" />
                          <span>Projects</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>


                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.pathname.startsWith('/dashboard/drift')}>
                        <Link to="/dashboard/drift">
                          <Waves className="mr-2 h-4 w-4" />
                          <span>Drift</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem> 

                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={location.pathname.startsWith('/dashboard/settings')}>
                        <Link to="/dashboard/settings/user">
                          <Settings className="mr-2 h-4 w-4" />
                          <span>Settings</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>



                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
            <div className="mt-auto p-4">
              <Link to="/logout" className="flex items-center">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Logout</span>
              </Link>
            </div>
          </Sidebar>
          <main className="flex-1 overflow-y-auto">
            <div className="p-4">
              <SidebarTrigger />
              <Outlet />
            </div>
          </main>

          {/* Copilot Sidebar */}
          <div
            className={`h-full border-l border-border bg-background transition-all duration-300 ease-in-out ${
              isCopilotOpen ? 'w-[800px]' : 'w-0'
            }`}
          >
            {isCopilotOpen && (
              <iframe
                src="https://oshu.dev/portal/734af699-8b2f-4501-b853-88e8e0f80020"
                style={{ width: '100%', height: '100%', border: 'none' }}
                allow="clipboard-write"
                title="Copilot Assistant"
              />
            )}
          </div>

          {/* Copilot Toggle Button */}
          <button
            onClick={() => setIsCopilotOpen(!isCopilotOpen)}
            className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
            aria-label={isCopilotOpen ? "Close Copilot" : "Open Copilot"}
          >
            {isCopilotOpen ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
          </button>
        </div>
        </WorkOsWidgets>
      </SidebarProvider>    
    )
};
