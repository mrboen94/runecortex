import './Navigation.css';

type ViewMode = 'timeline' | 'year' | 'month' | 'day';
type GroupBy = 'year' | 'month' | 'day' | 'none';

export type { ViewMode, GroupBy };

interface NavigationProps {
  viewMode: ViewMode;
  groupBy: GroupBy;
  onViewModeChange: (mode: ViewMode) => void;
  onGroupByChange: (groupBy: GroupBy) => void;
  breadcrumb?: React.ReactNode;
}

export default function Navigation({ viewMode, groupBy, onViewModeChange, onGroupByChange, breadcrumb }: NavigationProps) {
  return (
    <nav className="navigation">
      <div className="nav-section">
        <label>View:</label>
        <div className="button-group">
          <button 
            className={viewMode === 'timeline' ? 'active' : ''}
            onClick={() => onViewModeChange('timeline')}
          >
            Timeline
          </button>
          <button 
            className={viewMode === 'year' ? 'active' : ''}
            onClick={() => onViewModeChange('year')}
          >
            By Year
          </button>
          <button 
            className={viewMode === 'month' ? 'active' : ''}
            onClick={() => onViewModeChange('month')}
          >
            By Month
          </button>
          <button 
            className={viewMode === 'day' ? 'active' : ''}
            onClick={() => onViewModeChange('day')}
          >
            By Day
          </button>
        </div>
      </div>

      {viewMode === 'timeline' && (
        <div className="nav-section">
          <label>Group by:</label>
          <div className="button-group">
            <button 
              className={groupBy === 'none' ? 'active' : ''}
              onClick={() => onGroupByChange('none')}
            >
              None
            </button>
            <button 
              className={groupBy === 'year' ? 'active' : ''}
              onClick={() => onGroupByChange('year')}
            >
              Year
            </button>
            <button 
              className={groupBy === 'month' ? 'active' : ''}
              onClick={() => onGroupByChange('month')}
            >
              Month
            </button>
            <button 
              className={groupBy === 'day' ? 'active' : ''}
              onClick={() => onGroupByChange('day')}
            >
              Day
            </button>
          </div>
        </div>
      )}
      
      {breadcrumb && (
        <div className="nav-section nav-breadcrumb">
          {breadcrumb}
        </div>
      )}
    </nav>
  );
}