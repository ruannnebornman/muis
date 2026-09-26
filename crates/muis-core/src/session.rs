use serde::{Deserialize, Serialize};

/// One terminal tab: display title plus the cwd it was opened in.
/// The live pty handle lives in the worker process; the UI and the
/// session file only track this metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub title: String,
    pub cwd: String,
}

/// One named place (folder) holding a set of terminals.
/// Tabs keep running while another workspace is shown; the worker
/// processes own the ptys, this struct only owns the bookkeeping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub dir: String,
    pub tabs: Vec<Tab>,
    /// Index into `tabs` of the visible tab.
    pub active: usize,
}

/// All workspaces plus which one is shown. Serializable so quit/resume
/// is a plain file roundtrip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionStore {
    pub workspaces: Vec<Workspace>,
    pub current: usize,
    next_id: u64,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            workspaces: Vec::new(),
            current: 0,
            next_id: 1,
        }
    }

    /// The store always has at least one workspace to show.
    pub fn ensure_default(&mut self, name: &str, dir: &str) {
        if self.workspaces.is_empty() {
            let ws = self.add_workspace(name, dir);
            self.current = ws;
            self.new_tab("Terminal 1", dir);
        }
    }

    fn mint(&mut self, prefix: &str) -> String {
        let id = format!("{prefix}{}", self.next_id);
        self.next_id += 1;
        id
    }

    pub fn add_workspace(&mut self, name: &str, dir: &str) -> usize {
        let id = self.mint("w");
        self.workspaces.push(Workspace {
            id,
            name: name.to_string(),
            dir: dir.to_string(),
            tabs: Vec::new(),
            active: 0,
        });
        self.workspaces.len() - 1
    }

    pub fn remove_workspace(&mut self, index: usize) -> bool {
        if index >= self.workspaces.len() {
            return false;
        }
        self.workspaces.remove(index);
        if self.workspaces.is_empty() {
            self.current = 0;
        } else if self.current >= self.workspaces.len() {
            self.current = self.workspaces.len() - 1;
        } else if index < self.current {
            self.current -= 1;
        }
        true
    }

    pub fn switch(&mut self, index: usize) -> bool {
        if index >= self.workspaces.len() {
            return false;
        }
        self.current = index;
        true
    }

    pub fn current_workspace(&self) -> Option<&Workspace> {
        self.workspaces.get(self.current)
    }

    fn current_workspace_mut(&mut self) -> Option<&mut Workspace> {
        self.workspaces.get_mut(self.current)
    }

    /// Open a tab in the current workspace and make it visible.
    /// Returns the tab id, or None when there is no workspace.
    pub fn new_tab(&mut self, title: &str, cwd: &str) -> Option<String> {
        let id = self.mint("t");
        let ws = self.current_workspace_mut()?;
        ws.tabs.push(Tab {
            id: id.clone(),
            title: title.to_string(),
            cwd: cwd.to_string(),
        });
        ws.active = ws.tabs.len() - 1;
        Some(id)
    }

    /// Close a tab; the workspace's visible tab clamps to a live one.
    /// Returns false when the workspace or tab index is out of range.
    pub fn close_tab(&mut self, ws_index: usize, tab_index: usize) -> bool {
        let Some(ws) = self.workspaces.get_mut(ws_index) else {
            return false;
        };
        if tab_index >= ws.tabs.len() {
            return false;
        }
        ws.tabs.remove(tab_index);
        if ws.tabs.is_empty() {
            ws.active = 0;
        } else if ws.active >= ws.tabs.len() {
            ws.active = ws.tabs.len() - 1;
        } else if tab_index < ws.active {
            ws.active -= 1;
        }
        true
    }

    pub fn active_tab(&self) -> Option<&Tab> {
        let ws = self.current_workspace()?;
        ws.tabs.get(ws.active)
    }

    pub fn to_json(&self) -> serde_json::Result<String> {
        serde_json::to_string_pretty(self)
    }

    pub fn from_json(s: &str) -> serde_json::Result<Self> {
        serde_json::from_str(s)
    }
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> SessionStore {
        let mut s = SessionStore::new();
        s.ensure_default("home", "/home/kaazrot");
        s
    }

    #[test]
    fn default_has_one_workspace_with_one_tab() {
        let s = store();
        assert_eq!(s.workspaces.len(), 1);
        assert_eq!(s.current, 0);
        assert_eq!(s.active_tab().unwrap().title, "Terminal 1");
    }

    #[test]
    fn switch_rejects_out_of_range() {
        let mut s = store();
        assert!(!s.switch(7));
        assert_eq!(s.current, 0);
        s.add_workspace("veldmuis", "/home/kaazrot/Documents/code/veldmuis");
        assert!(s.switch(1));
        assert_eq!(s.current_workspace().unwrap().name, "veldmuis");
    }

    #[test]
    fn rapid_switching_keeps_per_workspace_active_tab() {
        let mut s = store();
        s.new_tab("Terminal 2", "/home/kaazrot");
        s.add_workspace("veldmuis", "/home/kaazrot/Documents/code/veldmuis");
        s.switch(1);
        s.new_tab("v1", "/home/kaazrot/Documents/code/veldmuis");
        s.new_tab("v2", "/home/kaazrot/Documents/code/veldmuis");
        s.switch(0);
        assert_eq!(s.active_tab().unwrap().title, "Terminal 2");
        s.switch(1);
        assert_eq!(s.active_tab().unwrap().title, "v2");
    }

    #[test]
    fn close_active_tab_clamps_to_live_tab() {
        let mut s = store();
        s.new_tab("Terminal 2", "/home/kaazrot");
        s.new_tab("Terminal 3", "/home/kaazrot");
        assert!(s.close_tab(0, 2));
        assert_eq!(s.active_tab().unwrap().title, "Terminal 2");
        assert!(s.close_tab(0, 0));
        assert_eq!(s.active_tab().unwrap().title, "Terminal 2");
        assert!(!s.close_tab(0, 5));
        assert!(!s.close_tab(3, 0));
    }

    #[test]
    fn remove_current_workspace_clamps_current() {
        let mut s = store();
        s.add_workspace("b", "/tmp/b");
        s.add_workspace("c", "/tmp/c");
        s.switch(2);
        assert!(s.remove_workspace(2));
        assert_eq!(s.current, 1);
        assert!(!s.remove_workspace(9));
    }

    #[test]
    fn session_json_roundtrip() {
        let mut s = store();
        s.add_workspace("veldmuis", "/home/kaazrot/Documents/code/veldmuis");
        let json = s.to_json().unwrap();
        let back = SessionStore::from_json(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn ids_are_unique_across_workspaces_and_tabs() {
        let mut s = store();
        s.add_workspace("b", "/tmp/b");
        s.switch(1);
        let a = s.new_tab("x", "/tmp").unwrap();
        let b = s.new_tab("y", "/tmp").unwrap();
        assert_ne!(a, b);
        let json = s.to_json().unwrap();
        let back = SessionStore::from_json(&json).unwrap();
        // Minting continues past restored state: no id reuse after resume.
        let mut back = back;
        back.switch(0);
        let c = back.new_tab("z", "/tmp").unwrap();
        assert_ne!(c, a);
        assert_ne!(c, b);
    }
}
